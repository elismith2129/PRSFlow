(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var html = document.documentElement;
  var SVGNS = 'http://www.w3.org/2000/svg';
  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ── theme: follow the app when this page is inside it ── */
  var themeBtn = document.getElementById('themeBtn');
  function setTheme(t) {
    html.setAttribute('data-theme', t);
    themeBtn.textContent = t === 'dark' ? 'View light' : 'View dark';
  }
  try {
    if (window.parent && window.parent !== window) {
      setTheme(window.parent.document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
    }
  } catch (e) { /* not same-origin: keep the default */ }
  themeBtn.addEventListener('click', function () { setTheme(html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); });

  /* ── walkthroughs ── */
  var walks = [];
  function Walk(el) {
    var self = this;
    this.el = el;
    this.def = WALKS[el.getAttribute('data-walk')];
    this.i = 0;
    this.stage = el.querySelector('.sop-stage');
    this.panel = el.querySelector('.sop-wpanel');
    var tpl = document.getElementById('tpl-' + this.def.scr);
    el.querySelector('.sop-stagein').appendChild(tpl.content.cloneNode(true));
    this.root = this.stage.querySelector('.scr');
    this.svg = document.createElementNS(SVGNS, 'svg');
    this.svg.setAttribute('class', 'sop-spot');
    this.svg.setAttribute('aria-hidden', 'true');
    this.stage.appendChild(this.svg);
    this.prev = el.querySelector('.sop-wprev');
    this.next = el.querySelector('.sop-wnext');
    this.prev.addEventListener('click', function () { self.go(self.i - 1, true); });
    this.next.addEventListener('click', function () { self.advance(); });
    // Click any part of the picture to jump to the step that explains it.
    this.stage.addEventListener('click', function (e) {
      for (var n = e.target; n && n !== self.stage; n = n.parentNode) {
        if (!n.getAttribute) continue;
        var ks = (n.getAttribute('data-k') || '').split(/\s+/);
        for (var a = 0; a < ks.length; a++) {
          if (!ks[a]) continue;
          var hit = self.stepFor(ks[a]);
          if (hit >= 0) { self.go(hit, true); return; }
        }
      }
    });
    // Screens may scroll sideways inside themselves on a phone: keep the ring on.
    this.stage.addEventListener('scroll', function () { self.queue(); }, true);
    this.render(false);
  }
  Walk.prototype.stepFor = function (key) {
    // Prefer a later match than the current step so repeated clicks walk forward.
    var steps = this.def.steps, first = -1;
    for (var i = 0; i < steps.length; i++) {
      if ((' ' + steps[i].k + ' ').indexOf(' ' + key + ' ') >= 0) {
        if (first < 0) first = i;
        if (i !== this.i) return i;
      }
    }
    return first;
  };
  Walk.prototype.nextWalk = function () {
    var n = this.el.nextElementSibling;
    while (n && !(n.classList && n.classList.contains('sop-walk'))) n = n.nextElementSibling;
    return n;
  };
  Walk.prototype.advance = function () {
    if (this.i < this.def.steps.length - 1) { this.go(this.i + 1, true); return; }
    var n = this.nextWalk();
    if (n) { scrollToY(n.getBoundingClientRect().top + window.pageYOffset - barH() - 10); return; }
    var sec = this.el.parentNode, nx = sec.querySelector('.sop-cnav.sop-cnext');
    if (nx) go(nx.getAttribute('data-go')); else this.go(0, true);
  };
  Walk.prototype.go = function (i, scroll) {
    this.i = Math.max(0, Math.min(this.def.steps.length - 1, i));
    this.render(scroll);
  };
  Walk.prototype.render = function (scroll) {
    var d = this.def, s = d.steps[this.i], n = d.steps.length, last = this.i === n - 1;
    this.el.querySelector('.sop-wk').textContent = 'Step ' + (this.i + 1) + ' of ' + n;
    this.el.querySelector('.sop-wbar i').style.width = (100 * (this.i + 1) / n) + '%';
    this.el.querySelector('.sop-wh').innerHTML = s.h;
    this.el.querySelector('.sop-wb').innerHTML = s.b;
    this.prev.disabled = this.i === 0;
    this.next.textContent = !last ? 'Next →' : this.nextWalk() ? 'Next part ↓' : this.el.parentNode.querySelector('.sop-cnav.sop-cnext') ? 'Next chapter →' : 'Start over ↺';
    if (s.s) this.root.setAttribute('data-state', s.s); else this.root.removeAttribute('data-state');
    var self = this;
    this.targets = null;
    requestAnimationFrame(function () {
      if (scroll) self.reveal();
      self.draw();
    });
  };
  Walk.prototype.find = function () {
    var s = this.def.steps[this.i], out = [], keys = s.k ? s.k.split(/\s+/) : [];
    for (var a = 0; a < keys.length; a++) {
      var els = this.root.querySelectorAll('[data-k~="' + keys[a] + '"]');
      for (var b = 0; b < els.length; b++) {
        var r = els[b].getBoundingClientRect();
        // Skip parts that are hidden in this state, and empty cells (a row with no flag).
        var blank = r.width > 48 && !els[b].firstElementChild && !els[b].textContent.replace(/\s+/g, '');
        if (r.width > 1 && r.height > 1 && !blank && out.indexOf(els[b]) < 0) out.push(els[b]);
      }
    }
    return out;
  };
  // Bring the lit part into view: sideways inside the screen, then down the page.
  Walk.prototype.reveal = function () {
    var els = this.find();
    var top, bottom;
    if (!els.length) {
      var sr = this.stage.getBoundingClientRect();
      top = sr.top; bottom = Math.min(sr.bottom, sr.top + 200);
    } else {
      var first = els[0];
      for (var p = first.parentNode; p && p !== this.stage.parentNode; p = p.parentNode) {
        if (p.scrollWidth > p.clientWidth + 2) {
          var pr = p.getBoundingClientRect(), fr = first.getBoundingClientRect();
          if (fr.left < pr.left + 8 || fr.right > pr.right - 8) {
            // Wider than the window it scrolls in: show its start. Otherwise centre it.
            p.scrollLeft += fr.width > pr.width - 24 ? fr.left - pr.left - 10
              : (fr.left + fr.width / 2) - (pr.left + pr.width / 2);
          }
        }
      }
      top = Infinity; bottom = -Infinity;
      for (var i = 0; i < els.length; i++) {
        var r = els[i].getBoundingClientRect();
        top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom);
      }
    }
    var pb = this.panel.getBoundingClientRect();
    var roomTop = Math.max(pb.bottom, barH() + pb.height + 6) + 16;
    var vh = window.innerHeight;
    if (top >= roomTop && bottom <= vh - 12) return;            // already in view
    var want = (bottom - top) > (vh - roomTop - 12) ? top - roomTop  // taller than the window: show its top
      : top - roomTop - Math.max(0, (vh - roomTop - (bottom - top)) * 0.25);
    scrollToY(window.pageYOffset + want);
  };
  Walk.prototype.queue = function () {
    var self = this;
    if (this.raf) return;
    this.raf = requestAnimationFrame(function () { self.raf = 0; self.draw(); });
  };
  Walk.prototype.draw = function () {
    var svg = this.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var sr = this.stage.getBoundingClientRect();
    if (sr.width < 2) return;                                    // chapter not on screen
    var els = this.find();
    if (!els.length) return;                                     // whole-screen step: nothing dimmed
    var w = this.stage.clientWidth, h = this.stage.clientHeight, pad = 5, id = 'mk-' + this.el.getAttribute('data-walk');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    var defs = mk('defs'), mask = mk('mask', { id: id, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: w, height: h });
    mask.appendChild(mk('rect', { x: 0, y: 0, width: w, height: h, fill: '#fff' }));
    var rings = [];
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      var x = Math.max(1, r.left - sr.left - pad), y = Math.max(1, r.top - sr.top - pad);
      var x2 = Math.min(w - 1, r.right - sr.left + pad), y2 = Math.min(h - 1, r.bottom - sr.top + pad);
      if (x2 - x < 4 || y2 - y < 4) continue;
      var rx = Math.min(12, (y2 - y) / 2);
      mask.appendChild(mk('rect', { x: x, y: y, width: x2 - x, height: y2 - y, rx: rx, fill: '#000' }));
      rings.push(mk('rect', { 'class': 'sop-ring', x: x, y: y, width: x2 - x, height: y2 - y, rx: rx }));
    }
    defs.appendChild(mask); svg.appendChild(defs);
    svg.appendChild(mk('rect', { 'class': 'sop-dimr', x: 0, y: 0, width: w, height: h, mask: 'url(#' + id + ')' }));
    for (var j = 0; j < rings.length; j++) svg.appendChild(rings[j]);
  };
  function mk(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
    return n;
  }
  function barH() { var b = document.querySelector('.sop-bar'); return b ? b.getBoundingClientRect().height : 44; }
  function scrollToY(y) {
    try { window.scrollTo({ top: Math.max(0, y), behavior: reduce ? 'auto' : 'smooth' }); }
    catch (e) { window.scrollTo(0, Math.max(0, y)); }
  }

  /* ── chapters ── */
  function go(id, keepScroll) {
    var sec = document.getElementById('s-' + id);
    if (!sec) return;
    all('.sop-section').forEach(function (x) { x.classList.toggle('on', x === sec); });
    all('.sop-ch').forEach(function (x) {
      var on = x.getAttribute('data-s') === id;
      x.classList.toggle('on', on);
      if (on && x.scrollIntoView && window.innerWidth <= 900) { try { x.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) {} }
    });
    if (!keepScroll) window.scrollTo(0, 0);
    try { history.replaceState(null, '', '#' + id); } catch (e) {}
    walks.forEach(function (w) { if (sec.contains(w.el)) w.queue(); });
  }
  window.go = go;
  all('.sop-ch').forEach(function (b) { b.addEventListener('click', function () { go(b.getAttribute('data-s')); }); });
  all('.sop-cnav').forEach(function (b) { b.addEventListener('click', function () { go(b.getAttribute('data-go')); }); });

  all('.sop-walk').forEach(function (el) { walks.push(new Walk(el)); });

  function redrawAll() { walks.forEach(function (w) { w.queue(); }); }
  window.addEventListener('resize', redrawAll);
  window.addEventListener('load', redrawAll);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(redrawAll);

  // ← / → step the walkthrough you are looking at.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var best = null, bestD = Infinity, mid = window.innerHeight / 2;
    walks.forEach(function (w) {
      var r = w.el.getBoundingClientRect();
      if (r.width < 2 || r.bottom < 0 || r.top > window.innerHeight) return;
      var d = r.top <= mid && r.bottom >= mid ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid));
      if (d < bestD) { bestD = d; best = w; }
    });
    if (!best) return;
    e.preventDefault();
    if (e.key === 'ArrowRight') { if (best.i < best.def.steps.length - 1) best.go(best.i + 1, true); }
    else best.go(best.i - 1, true);
  });

  var start = (location.hash || '').replace('#', '');
  if (start && document.getElementById('s-' + start)) go(start, true);
})();
