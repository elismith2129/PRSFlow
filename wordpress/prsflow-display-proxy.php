<?php
/**
 * Plugin Name: PRSFlo Display Proxy
 * Description: Serves PRSFlo TV calendar pages over plain HTTP for the Sharp panels. TVs point at http://paramountrecordingla.com/prsflow-display/{room-slug} — this host they already trust. The plugin fetches the page from Vercel server-side and hands it to the TV, so no certificate is ever involved on the panel.
 * Version: 1.1
 * Author: Paramount Recording Group
 *
 * REPO ARCHIVE COPY (see docs/TV-DISPLAY-BRIEF.md, "SHIPPED ARCHITECTURE").
 * The LIVE copy is installed on paramountrecordingla.com (wp-admin → Plugins).
 * PRSFLO_DISPLAY_KEY below is a PLACEHOLDER — the real shared secret lives in
 * the installed plugin and in the two Vercel firewall rules (project →
 * Firewall → "TV Displays" / "TV Displays Deny"). If you ever rebuild the
 * zip from this file, copy the live key in first or every TV goes white.
 * To zip: put this file alone in a folder `prsflow-display-proxy/`, zip the
 * folder, upload via Plugins → Add New → Upload → "Replace current with
 * uploaded".
 */

if (!defined('ABSPATH')) { exit; }

define('PRSFLO_DISPLAY_UPSTREAM', 'https://prsflow.paramountrecording.com/display/');
define('PRSFLO_DISPLAY_PREFIX', '/prsflow-display/');
// Shared secret: the Vercel firewall only answers /display requests carrying
// this header. Must match the value in the Vercel firewall rules exactly.
define('PRSFLO_DISPLAY_KEY', 'REPLACE-WITH-LIVE-KEY-SEE-VERCEL-FIREWALL');

add_action('init', 'prsflo_display_proxy_intercept', 0);

function prsflo_display_proxy_intercept() {
    $uri = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '';

    if (strpos($uri, PRSFLO_DISPLAY_PREFIX) !== 0) {
        return; // not ours — let WordPress carry on
    }

    // Split path from query string
    $parts = explode('?', $uri, 2);
    $path  = $parts[0];
    $query = isset($parts[1]) ? $parts[1] : '';

    // Extract and validate the room slug (e.g. ers-b). Lowercase letters,
    // digits, hyphens only — prevents this from being used as an open proxy.
    $slug = trim(substr($path, strlen(PRSFLO_DISPLAY_PREFIX)), '/');
    if ($slug === '' || !preg_match('/^[a-z0-9-]{1,40}$/', $slug)) {
        status_header(404);
        header('Content-Type: text/html; charset=utf-8');
        header('X-Robots-Tag: noindex, nofollow');
        echo '<html><body style="background:#000;color:#fff;font-size:48px;font-family:sans-serif;padding:40px">Unknown room</body></html>';
        exit;
    }

    // Pass the query string through untouched — the page's auto-refresh
    // poller and the ?diag=1 test page both depend on this.
    $upstream = PRSFLO_DISPLAY_UPSTREAM . $slug . ($query !== '' ? '?' . $query : '');

    $response = wp_remote_get($upstream, array(
        'timeout'     => 20,
        'redirection' => 3,
        'sslverify'   => true,
        'headers'     => array(
            'Accept'               => 'text/html,*/*',
            'x-prsflo-display-key' => PRSFLO_DISPLAY_KEY,
        ),
    ));

    header('Cache-Control: no-store, no-cache, must-revalidate');
    header('Pragma: no-cache');
    // Keep these pages out of search engines.
    header('X-Robots-Tag: noindex, nofollow');

    if (is_wp_error($response) || wp_remote_retrieve_response_code($response) >= 500) {
        // Upstream unreachable: show a calm self-healing page instead of white.
        // Meta refresh retries every 15 seconds until Vercel answers again.
        status_header(200);
        header('Content-Type: text/html; charset=utf-8');
        echo '<html><head><meta http-equiv="refresh" content="15"></head>'
           . '<body style="background:#0d0f14;color:#e8eaf0;font-family:sans-serif;'
           . 'display:table;width:100%;height:100%;margin:0">'
           . '<div style="display:table-cell;vertical-align:middle;text-align:center;font-size:52px">'
           . 'Reconnecting&hellip;</div></body></html>';
        exit;
    }

    $code = wp_remote_retrieve_response_code($response);
    $type = wp_remote_retrieve_header($response, 'content-type');
    if (!$type) { $type = 'text/html; charset=utf-8'; }

    status_header($code);
    header('Content-Type: ' . $type);
    echo wp_remote_retrieve_body($response);
    exit;
}
