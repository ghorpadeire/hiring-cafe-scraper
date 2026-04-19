'use strict';

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const BRAVE_PROFILE = path.join(
  process.env.LOCALAPPDATA || '',
  'BraveSoftware/Brave-Browser/User Data/Default/Network/Cookies'
);
const BRAVE_STATE = path.join(
  process.env.LOCALAPPDATA || '',
  'BraveSoftware/Brave-Browser/User Data/Local State'
);
const CHROME_PROFILE = path.join(
  process.env.LOCALAPPDATA || '',
  'Google/Chrome/User Data/Default/Network/Cookies'
);
const CHROME_STATE = path.join(
  process.env.LOCALAPPDATA || '',
  'Google/Chrome/User Data/Local State'
);

function browserPair() {
  if (fs.existsSync(BRAVE_PROFILE))  return [BRAVE_PROFILE, BRAVE_STATE];
  if (fs.existsSync(CHROME_PROFILE)) return [CHROME_PROFILE, CHROME_STATE];
  return [null, null];
}

/**
 * Try to auto-read the cf_clearance cookie for hiring.cafe from the user's
 * Chrome/Brave profile (Windows only).  Works only when the browser is CLOSED.
 * Returns the plaintext cookie value string or null.
 */
async function readCfClearance() {
  if (process.platform !== 'win32') return null;

  const [dbPath, statePath] = browserPair();
  if (!dbPath || !statePath) return null;

  // Try to copy the locked file — succeeds only when the browser is closed
  const tmpDb  = path.join(os.tmpdir(), `hcs_cookies_${Date.now()}.db`);
  const tmpWal = tmpDb + '-wal';
  const tmpShm = tmpDb + '-shm';

  try {
    fs.copyFileSync(dbPath, tmpDb);
    const walSrc = dbPath + '-wal';
    const shmSrc = dbPath + '-shm';
    if (fs.existsSync(walSrc)) fs.copyFileSync(walSrc, tmpWal);
    if (fs.existsSync(shmSrc)) fs.copyFileSync(shmSrc, tmpShm);
  } catch {
    // Browser is running — can't read the locked file
    return null;
  }

  try {
    // Use PowerShell to:
    // 1. DPAPI-decrypt the AES key from Local State
    // 2. AES-256-GCM decrypt the cookie value
    // 3. Query the SQLite via Invoke-SqliteQuery or raw bytes
    const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

# Decrypt AES key from Local State
$state = Get-Content '${statePath.replace(/\\/g, '\\\\')}' -Raw | ConvertFrom-Json
$encKeyB64 = $state.os_crypt.encrypted_key
$encKeyRaw = [System.Convert]::FromBase64String($encKeyB64)
$encKeyNoPrefix = $encKeyRaw[5..($encKeyRaw.Length-1)]
$aesKey = [System.Security.Cryptography.ProtectedData]::Unprotect($encKeyNoPrefix, $null, 'CurrentUser')

# Load SQLite bytes and find cf_clearance for hiring.cafe
# We parse the file manually to find the encrypted cookie value
$dbBytes = [System.IO.File]::ReadAllBytes('${tmpDb.replace(/\\/g, '\\\\')}')
$dbText  = [System.Text.Encoding]::Latin1.GetString($dbBytes)

# SQLite page size is in bytes 16-17 (big-endian)
# We'll use a simpler approach: search for 'cf_clearance' marker
$marker = [System.Text.Encoding]::UTF8.GetBytes('cf_clearance')
$markerStr = 'cf_clearance'

# Find the cookie via regex on the raw binary string
$idx = $dbText.IndexOf($markerStr)
if ($idx -lt 0) { Write-Output 'NOTFOUND'; exit 0 }

# Extract up to 600 bytes after the marker to find the encrypted blob
$chunk = $dbBytes[($idx+12)..([Math]::Min($idx+612, $dbBytes.Length-1))]

# Find the v10/v11 prefix (encrypted_value starts with 0x76 0x31 0x30 = 'v10')
$v10 = @(0x76, 0x31, 0x30)
$blobStart = -1
for ($i = 0; $i -lt $chunk.Length - 3; $i++) {
  if ($chunk[$i] -eq 0x76 -and $chunk[$i+1] -eq 0x31 -and ($chunk[$i+2] -eq 0x30 -or $chunk[$i+2] -eq 0x31)) {
    $blobStart = $i; break
  }
}
if ($blobStart -lt 0) { Write-Output 'NOTFOUND'; exit 0 }

# Encrypted value structure: v10 + 12-byte nonce + ciphertext + 16-byte tag
# Total blob length varies; try reasonable length
$nonce = $chunk[($blobStart+3)..($blobStart+14)]
$cipherWithTag = $chunk[($blobStart+15)..($blobStart+200)]

# AES-256-GCM decrypt
$aes = [System.Security.Cryptography.AesGcm]::new($aesKey, 16)
$tag = $cipherWithTag[($cipherWithTag.Length-16)..($cipherWithTag.Length-1)]
$cipher = $cipherWithTag[0..($cipherWithTag.Length-17)]
$plain = New-Object byte[] $cipher.Length
$aes.Decrypt($nonce, $cipher, $tag, $plain)
$cookieVal = [System.Text.Encoding]::UTF8.GetString($plain)
Write-Output $cookieVal
`;

    const result = execSync(
      `powershell -NonInteractive -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
      { encoding: 'utf8', timeout: 15000, windowsHide: true }
    ).trim();

    if (result && result !== 'NOTFOUND' && result.length > 10) return result;
    return null;
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(tmpDb); } catch {}
    try { fs.unlinkSync(tmpWal); } catch {}
    try { fs.unlinkSync(tmpShm); } catch {}
  }
}

module.exports = { readCfClearance };
