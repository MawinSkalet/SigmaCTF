<?php
// INTENTIONALLY VULNERABLE CTF LAB. Deploy only through the SigmaCTF sandbox.
$result = '';
if (isset($_GET['host']) && is_string($_GET['host'])) {
    $result = shell_exec('ping -c 1 -W 1 ' . substr($_GET['host'], 0, 256) . ' 2>&1') ?? '';
}
?>
<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ping of Ohio</title>
<style>body{background:#050507;color:#22c55e;font:16px monospace;max-width:760px;margin:10vh auto;padding:24px}h1{font-size:32px}p{color:#a0a7b6;line-height:1.7}input,button{font:inherit;padding:12px;background:#14161f;border:1px solid #46534b;color:#eee}button{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #30372e;padding:20px;min-height:120px}</style>
<p>OHIO NETWORK OPERATIONS / DIAGNOSTICS</p><h1>Is it alive?</h1><p>Enter a host. Get a ping. What could possibly go wrong?</p><form><label for="host">Host </label><input id="host" name="host" value="127.0.0.1" maxlength="256"><button>Ping</button></form><pre><?= htmlspecialchars($result, ENT_QUOTES, 'UTF-8') ?></pre></html>
