const fs = require('fs');
const path = require('path');

// Fix: The script is in src/plugin/scripts/, but manifest/package.json are in src/plugin/
const manifestPath = path.join(__dirname, '..', 'manifest.json');
const packagePath = path.join(__dirname, '..', 'package.json');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

if (manifest.version !== pkg.version) {
  console.log(
    `Updating manifest.json version from ${manifest.version} to ${pkg.version}`,
  );
  manifest.version = pkg.version;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}
