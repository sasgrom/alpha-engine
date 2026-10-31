# Create a self-signed localhost callback certificate for local development only.
$ErrorActionPreference = "Stop"
$dir = "worker\cache\schwab"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$cert = New-SelfSignedCertificate `
  -DnsName "localhost" `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -NotAfter (Get-Date).AddYears(2)
$password = ConvertTo-SecureString "alpha-callback" -AsPlainText -Force
Export-PfxCertificate -Cert $cert -FilePath "$dir\callback.pfx" -Password $password
Write-Host "Created $dir\callback.pfx. Import it into Windows Trusted Root only for local development if desired."
