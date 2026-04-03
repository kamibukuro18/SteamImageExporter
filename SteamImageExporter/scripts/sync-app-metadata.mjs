import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

const metadataPath = path.join(rootDir, 'src', 'config', 'app-metadata.json')
const packageJsonPath = path.join(rootDir, 'package.json')
const packageLockPath = path.join(rootDir, 'package-lock.json')
const tauriConfigPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json')

const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
const packageLock = JSON.parse(readFileSync(packageLockPath, 'utf8'))
const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, 'utf8'))

packageJson.version = metadata.appVersion
packageLock.version = metadata.appVersion
if (packageLock.packages?.['']) {
  packageLock.packages[''].version = metadata.appVersion
}

tauriConfig.productName = metadata.appName
if (Array.isArray(tauriConfig.app?.windows)) {
  tauriConfig.app.windows = tauriConfig.app.windows.map((window) => ({
    ...window,
    title: metadata.appName,
  }))
}
tauriConfig.version = metadata.appVersion

writeJson(packageJsonPath, packageJson)
writeJson(packageLockPath, packageLock)
writeJson(tauriConfigPath, tauriConfig)

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}
