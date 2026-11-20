// ─────────────────────────────────────────────────────────────────────────────
// PRSFlo Room Lock — the agent that runs on a studio room's Mac.
// (Eli, 2026-11-19. The office side is /rooms in PRSFlo; the database side is
// supabase/migrations/20261119150000_room_locks.sql.)
//
// Every 3 seconds it asks PRSFlo "what state is my room in?" and does one of:
//   unlocked  nothing on screen
//   warning   a small countdown banner at the top of the screen; a click
//             closes it (it returns at 15 and at 5 minutes left); when the
//             countdown runs out it locks by itself, internet or not
//   locked    a black screen over every display, above every app; keyboard and
//             mouse go nowhere; the Mac's sound is muted. Pro Tools keeps
//             running underneath — nothing is closed, nothing is lost.
//
// CLEARING A LOCK
//   1. Unlock in PRSFlo (the normal way).
//   2. The staff PIN, typed BLIND on this Mac's keyboard, then Return. There is
//      deliberately no PIN box on screen (Eli: "if it exists on the screen,
//      clients will bully my staff into just clearing it"). This works with
//      the internet down: the Mac holds a one-way scramble of the PIN, never
//      the PIN itself.
//
// IF THE INTERNET DROPS the Mac stays in whatever state it was last told. An
// outage never locks a session by itself (a warning already counting down
// still finishes).
//
// IF THE MAC IS RESTARTED WHILE LOCKED it comes back locked: the last state is
// saved to disk and the installer sets this to start at login and restart if
// it is quit.
//
// Built by scripts/room-lock/build.sh. Settings come from config.json beside
// the saved state in ~/Library/Application Support/PRSFloRoomLock/.
// ─────────────────────────────────────────────────────────────────────────────

import AppKit
import CryptoKit

struct Config: Codable {
    var supabaseUrl: String
    var anonKey: String
    var room: String        // e.g. "prs-a"
    var key: String         // this room's secret key
    var roomLabel: String   // e.g. "PARAMOUNT · STUDIO A"
    var testEscape: Bool?   // TEST ROOMS ONLY: Control+Option+Command+U clears a lock
}

struct Saved: Codable {
    var state: String = "unlocked"
    var lockAt: Double? = nil       // server clock, seconds since 1970
    var pinHash: String? = nil
    var pendingUnlock: Bool = false // unlocked here by PIN; PRSFlo not told yet
    var weMuted: Bool = false
}

let supportDir = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/PRSFloRoomLock")
let configURL = supportDir.appendingPathComponent("config.json")
let savedURL = supportDir.appendingPathComponent("state.json")

func log(_ s: String) {
    print("\(Date()) \(s)")
    fflush(stdout)
}

/// A borderless window refuses the keyboard unless it says otherwise.
final class LockWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

final class LockView: NSView {
    weak var agent: Agent?
    override var acceptsFirstResponder: Bool { true }
    override func keyDown(with event: NSEvent) { agent?.key(event) }
    // Swallow every shortcut (Cmd+Q, Cmd+Tab's cousins, etc.) while locked.
    override func performKeyEquivalent(with event: NSEvent) -> Bool { agent?.key(event); return true }
    override func mouseDown(with event: NSEvent) {}
    override func rightMouseDown(with event: NSEvent) {}
    override func draw(_ dirtyRect: NSRect) { NSColor.black.setFill(); dirtyRect.fill() }
}

/// The warning banner. A click anywhere on it closes it (Eli, 2026-11-19: "the
/// banner warning should be click out able").
final class BannerView: NSView {
    weak var agent: Agent?
    override func hitTest(_ point: NSPoint) -> NSView? { self }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { agent?.dismissBanner() }
}

final class Agent: NSObject, NSApplicationDelegate {
    var config: Config!
    var saved = Saved()
    var clockOffset: Double = 0          // server clock minus this Mac's clock
    var lockWindows: [LockWindow] = []
    var banner: NSWindow?
    var bannerLabel: NSTextField?
    var dismissedFor: Double? = nil     // which warning (its lock time) was clicked away
    var hideUntilLeft: Int? = nil       // stay hidden until this many seconds are left (-1 = for good)
    var typed = ""
    var lastKeyAt = Date.distantPast
    var ticks = 0
    var polling = false
    var lastFailLog = Date.distantPast

    // ── start ────────────────────────────────────────────────────────────────
    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let data = try? Data(contentsOf: configURL),
              let c = try? JSONDecoder().decode(Config.self, from: data) else {
            log("No readable config.json at \(configURL.path) — quitting.")
            exit(2)
        }
        config = c
        if let d = try? Data(contentsOf: savedURL), let s = try? JSONDecoder().decode(Saved.self, from: d) { saved = s }
        log("Started for room \(config.room); last known state \(saved.state)")

        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged),
            name: NSApplication.didChangeScreenParametersNotification, object: nil)

        apply()
        poll()
        Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
    }

    func save() {
        try? FileManager.default.createDirectory(at: supportDir, withIntermediateDirectories: true)
        if let d = try? JSONEncoder().encode(saved) { try? d.write(to: savedURL, options: .atomic) }
    }

    var serverNow: Double { Date().timeIntervalSince1970 + clockOffset }

    /// A warning that has run out IS a lock.
    var effective: String {
        if saved.state == "warning", let at = saved.lockAt, serverNow >= at { return "locked" }
        return saved.state
    }

    // ── once a second ────────────────────────────────────────────────────────
    func tick() {
        ticks += 1
        if ticks % 3 == 0 { poll() }
        apply()
        if effective == "locked" {
            // Stay on top and keep the keyboard, whatever else tries to come forward.
            NSApp.activate(ignoringOtherApps: true)
            for w in lockWindows { w.orderFrontRegardless() }
            lockWindows.first?.makeKeyAndOrderFront(nil)
            if ticks % 5 == 0 { setMuted(true) }
        }
    }

    // ── talk to PRSFlo ───────────────────────────────────────────────────────
    func rpc(_ name: String, done: @escaping ([String: Any]?, Bool) -> Void) {
        guard let url = URL(string: "\(config.supabaseUrl)/rest/v1/rpc/\(name)") else { done(nil, false); return }
        var req = URLRequest(url: url, timeoutInterval: 8)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(config.anonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(config.anonKey)", forHTTPHeaderField: "Authorization")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["p_room": config.room, "p_key": config.key])
        URLSession.shared.dataTask(with: req) { data, resp, err in
            let code = (resp as? HTTPURLResponse)?.statusCode
            let ok = code.map { (200..<300).contains($0) } ?? false
            let obj = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
            DispatchQueue.main.async {
                // A failed check-in is written to agent.log, at most once a
                // minute, so "why is the dot not green" has an answer on disk.
                if !ok, Date().timeIntervalSince(self.lastFailLog) > 60 {
                    self.lastFailLog = Date()
                    let body = data.flatMap { String(data: $0, encoding: .utf8) }?.prefix(300) ?? ""
                    log("\(name) FAILED: \(code.map { "HTTP \($0)" } ?? "no answer") \(err?.localizedDescription ?? "") \(body)")
                }
                done(obj, ok)
            }
        }.resume()
    }

    func poll() {
        if polling { return }
        polling = true

        // Unlocked here by PIN while PRSFlo still says locked: tell PRSFlo
        // first, or the next answer would lock the room again.
        if saved.pendingUnlock {
            rpc("room_lock_pin_unlock") { [weak self] _, ok in
                guard let self = self else { return }
                self.polling = false
                if ok { self.saved.pendingUnlock = false; self.save(); log("PRSFlo told about the PIN unlock") }
            }
            return
        }

        rpc("room_lock_poll") { [weak self] obj, ok in
            guard let self = self else { return }
            self.polling = false
            // No answer, or a refusal: keep the state we have. Never guess.
            guard ok, let obj = obj, let state = obj["state"] as? String,
                  ["unlocked", "warning", "locked"].contains(state) else { return }
            if self.saved.pendingUnlock { return }   // PIN typed while this was in flight
            if let now = obj["now"] as? Double { self.clockOffset = now - Date().timeIntervalSince1970 }
            if state != self.saved.state { log("State: \(self.saved.state) -> \(state)") }
            self.saved.state = state
            self.saved.lockAt = obj["lock_at"] as? Double
            if let h = obj["pin_hash"] as? String { self.saved.pinHash = h }
            self.save()
            self.apply()
        }
    }

    // ── make the screen match the state ──────────────────────────────────────
    func apply() {
        switch effective {
        case "locked":
            hideBanner()
            showLock()
        case "warning":
            hideLock()
            showBanner()
        default:
            hideBanner()
            hideLock()
        }
    }

    @objc func screensChanged() {
        if !lockWindows.isEmpty { closeLockWindows(); showLock() }
        if banner != nil { hideBanner(); apply() }
    }

    func showLock() {
        if !lockWindows.isEmpty { return }
        log("Locking the screen")
        for screen in NSScreen.screens {
            let w = LockWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
            w.level = NSWindow.Level(rawValue: Int(CGShieldingWindowLevel()))
            w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
            w.isOpaque = true
            w.backgroundColor = .black
            w.hidesOnDeactivate = false
            w.isReleasedWhenClosed = false
            let v = LockView(frame: NSRect(origin: .zero, size: screen.frame.size))
            v.agent = self
            v.autoresizingMask = [.width, .height]

            let title = label("Session time has ended.", size: 54, weight: .heavy, alpha: 1)
            let sub = label("Please see the front desk.", size: 22, weight: .regular, alpha: 0.65)
            let room = label(config.roomLabel, size: 12, weight: .medium, alpha: 0.3)
            let stack = NSStackView(views: [title, sub, room])
            stack.orientation = .vertical
            stack.spacing = 14
            stack.setCustomSpacing(40, after: sub)
            stack.translatesAutoresizingMaskIntoConstraints = false
            v.addSubview(stack)
            NSLayoutConstraint.activate([
                stack.centerXAnchor.constraint(equalTo: v.centerXAnchor),
                stack.centerYAnchor.constraint(equalTo: v.centerYAnchor),
            ])
            w.contentView = v
            w.setFrame(screen.frame, display: true)
            w.orderFrontRegardless()
            w.makeFirstResponder(v)
            lockWindows.append(w)
        }
        // Apple's kiosk mode: no Dock, no menu bar, no app switching, no Force
        // Quit, no logging out from the keyboard.
        NSApp.presentationOptions = [.hideDock, .hideMenuBar, .disableProcessSwitching,
                                     .disableForceQuit, .disableSessionTermination, .disableHideApplication]
        NSApp.activate(ignoringOtherApps: true)
        lockWindows.first?.makeKeyAndOrderFront(nil)
        typed = ""
        if !saved.weMuted && !isMuted() { saved.weMuted = true; save() }
        setMuted(true)
    }

    func closeLockWindows() {
        for w in lockWindows { w.orderOut(nil); w.close() }
        lockWindows.removeAll()
    }

    func hideLock() {
        if lockWindows.isEmpty { return }
        log("Clearing the lock screen")
        closeLockWindows()
        NSApp.presentationOptions = []
        // Only un-mute if it was us who muted. A room that was muted before
        // the lock stays muted.
        if saved.weMuted { setMuted(false); saved.weMuted = false; save() }
    }

    func label(_ text: String, size: CGFloat, weight: NSFont.Weight, alpha: CGFloat) -> NSTextField {
        let l = NSTextField(labelWithString: text)
        l.font = NSFont.systemFont(ofSize: size, weight: weight)
        l.textColor = NSColor(white: 0.95, alpha: alpha)
        l.alignment = .center
        return l
    }

    // ── the 30-minute banner ─────────────────────────────────────────────────
    func showBanner() {
        guard let at = saved.lockAt else { return }
        let left = max(0, Int(at - serverNow))
        // Clicked away? It stays away, but comes back at 15 minutes left and
        // again at 5 (Eli: "maybe another 15 minute warning"), so the lock is
        // never a surprise. Each return can be clicked away too. A new
        // warning starts fresh.
        if dismissedFor != at { dismissedFor = nil; hideUntilLeft = nil }
        if let h = hideUntilLeft, left > h { hideBanner(); return }
        let text = String(format: "Session ends in %d:%02d  ·  see the front desk to add time    ✕", left / 60, left % 60)
        if let l = bannerLabel { l.stringValue = text; return }

        guard let screen = NSScreen.main else { return }
        let size = NSSize(width: 600, height: 46)
        let origin = NSPoint(x: screen.frame.midX - size.width / 2, y: screen.visibleFrame.maxY - size.height - 10)
        // A non-activating panel: clicking it does NOT pull the keyboard away
        // from Pro Tools.
        let w = NSPanel(contentRect: NSRect(origin: origin, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        w.becomesKeyOnlyIfNeeded = true
        w.level = .statusBar
        w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        w.isOpaque = false
        w.backgroundColor = .clear
        w.ignoresMouseEvents = false     // a click on the banner closes it
        w.hasShadow = true
        w.isReleasedWhenClosed = false
        let box = BannerView(frame: NSRect(origin: .zero, size: size))
        box.agent = self
        box.wantsLayer = true
        box.layer?.backgroundColor = NSColor(red: 1.0, green: 0.66, blue: 0.30, alpha: 0.97).cgColor
        box.layer?.cornerRadius = 23
        let l = NSTextField(labelWithString: text)
        l.font = NSFont.monospacedDigitSystemFont(ofSize: 15, weight: .bold)
        l.textColor = NSColor(red: 0.12, green: 0.08, blue: 0.03, alpha: 1)
        l.alignment = .center
        l.translatesAutoresizingMaskIntoConstraints = false
        box.addSubview(l)
        NSLayoutConstraint.activate([
            l.centerXAnchor.constraint(equalTo: box.centerXAnchor),
            l.centerYAnchor.constraint(equalTo: box.centerYAnchor),
        ])
        w.contentView = box
        w.orderFrontRegardless()
        banner = w
        bannerLabel = l
        log("Showing the warning banner")
    }

    func dismissBanner() {
        guard let at = saved.lockAt else { return }
        dismissedFor = at
        let left = Int(at - serverNow)
        hideUntilLeft = [900, 300].first { $0 < left } ?? -1
        log("Warning banner clicked away")
        hideBanner()
    }

    func hideBanner() {
        guard let w = banner else { return }
        w.orderOut(nil); w.close()
        banner = nil
        bannerLabel = nil
    }

    // ── the hidden PIN ───────────────────────────────────────────────────────
    func key(_ event: NSEvent) {
        guard event.type == .keyDown, effective == "locked" else { return }

        if config.testEscape == true,
           event.modifierFlags.intersection(.deviceIndependentFlagsMask).contains([.control, .option, .command]),
           event.charactersIgnoringModifiers?.lowercased() == "u" {
            log("Test escape used")
            unlockHere()
            return
        }

        // A pause of 10 seconds starts the PIN over.
        if Date().timeIntervalSince(lastKeyAt) > 10 { typed = "" }
        lastKeyAt = Date()

        if event.keyCode == 36 || event.keyCode == 76 {       // Return, keypad Enter
            let attempt = typed
            typed = ""
            guard attempt.count == 6, let want = saved.pinHash else { return }
            let digest = SHA256.hash(data: Data("\(attempt):\(config.key)".utf8))
            let hex = digest.map { String(format: "%02x", $0) }.joined()
            if hex == want { log("Unlocked with the staff PIN"); unlockHere() }
            return
        }
        if let ch = event.characters, ch.count == 1, let c = ch.first, c.isASCII, c.isNumber {
            typed = String((typed + ch).suffix(6))
        } else {
            typed = ""
        }
    }

    func unlockHere() {
        saved.state = "unlocked"
        saved.lockAt = nil
        saved.pendingUnlock = true
        save()
        apply()
        poll()
    }

    // ── sound ────────────────────────────────────────────────────────────────
    // The Mac's own output mute. NOTE: an audio interface or console that does
    // its monitoring in hardware ignores this — that is what the speaker piece
    // is for (parked, 2026-11-19).
    func osascript(_ script: String) -> String {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        p.arguments = ["-e", script]
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = Pipe()
        do { try p.run() } catch { return "" }
        p.waitUntilExit()
        return String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }
    func isMuted() -> Bool { osascript("output muted of (get volume settings)") == "true" }
    func setMuted(_ on: Bool) { _ = osascript("set volume output muted \(on ? "true" : "false")") }
}

let app = NSApplication.shared
let agent = Agent()
app.delegate = agent
app.setActivationPolicy(.accessory)   // no Dock icon, no menu bar
app.run()
