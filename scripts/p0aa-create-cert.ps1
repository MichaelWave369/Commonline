param(
  [string]$OutputDir = "pilot-local\\tls",
  [string]$DnsName = $env:COMPUTERNAME
)

$ErrorActionPreference = "Stop"

if (-not $DnsName) {
  throw "Could not determine the Windows computer name."
}

$fullOutputDir = [System.IO.Path]::GetFullPath(
  (Join-Path (Get-Location) $OutputDir)
)
New-Item -ItemType Directory -Force -Path $fullOutputDir | Out-Null

$pfxPath = Join-Path $fullOutputDir "commonline-pilot.pfx"
$cerPath = Join-Path $fullOutputDir "commonline-pilot.cer"
$passphrasePath = Join-Path $fullOutputDir "pfx-passphrase.txt"

$passphrase = [Guid]::NewGuid().ToString("N")
$securePassphrase = ConvertTo-SecureString -String $passphrase -AsPlainText -Force

$cert = New-SelfSignedCertificate `
  -Type SSLServerAuthentication `
  -Subject "CN=$DnsName" `
  -DnsName @($DnsName, "localhost") `
  -CertStoreLocation "Cert:\\CurrentUser\\My" `
  -FriendlyName "Commonline P0 Pilot" `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable `
  -NotAfter (Get-Date).AddDays(30)

Export-PfxCertificate `
  -Cert $cert `
  -FilePath $pfxPath `
  -Password $securePassphrase `
  -Force | Out-Null

Export-Certificate `
  -Cert $cert `
  -FilePath $cerPath `
  -Type CERT `
  -Force | Out-Null

Set-Content -Path $passphrasePath -Value $passphrase -NoNewline

Import-Certificate `
  -FilePath $cerPath `
  -CertStoreLocation "Cert:\\CurrentUser\\Root" | Out-Null

$lanAddresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object {
    $_.IPAddress -notlike "127.*" -and
    $_.IPAddress -notlike "169.254.*"
  } |
  Select-Object -ExpandProperty IPAddress -Unique

Write-Host ""
Write-Host "P0-aa certificate READY"
Write-Host "hostname=$DnsName"
Write-Host "pfx=$pfxPath"
Write-Host "publicCert=$cerPath"
Write-Host "passphraseFile=$passphrasePath"
if ($lanAddresses) {
  Write-Host ("lanCandidates=" + ($lanAddresses -join ","))
}
Write-Host ""
Write-Host "Host PowerShell:"
Write-Host '$env:COMMONLINE_TLS_PFX_PASSPHRASE = Get-Content "pilot-local\tls\pfx-passphrase.txt"'
Write-Host ""
Write-Host "Second PC:"
Write-Host "1. Copy ONLY commonline-pilot.cer to the second PC."
Write-Host '2. Import-Certificate -FilePath ".\commonline-pilot.cer" -CertStoreLocation "Cert:\CurrentUser\Root"'
Write-Host "3. Open https://$DnsName`:5173 after the pilot host starts."
Write-Host ""
Write-Host "Do not copy the .pfx or pfx-passphrase.txt to participant devices."
