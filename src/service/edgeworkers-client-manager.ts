import * as cliUtils from '../utils/cli-utils';
const fs = require('fs');
const path = require('path');
const tar = require('tar');
const untildify = require('untildify');
const sha256File = require('sha256-file');

const CLI_CACHE_PATH: string = process.env.AKAMAI_CLI_CACHE_PATH;
const EDGEWORKERS_CLI_HOME = path.join(CLI_CACHE_PATH, '/edgeworkers-cli/');
const EDGEWORKERS_DIR = path.join(EDGEWORKERS_CLI_HOME, '/edgeworkers/');
const MAINJS_FILENAME = 'main.js';
const MANIFEST_FILENAME = 'bundle.json';
const TARBALL_VERSION_KEY = 'edgeworker-version';
const BUNDLE_FORMAT_VERSION_KEY = 'bundle-version';
const JSAPI_VERSION_KEY = 'api-version';
var tarballChecksum = undefined;

if (!fs.existsSync(EDGEWORKERS_CLI_HOME)) {
  fs.mkdirSync(EDGEWORKERS_CLI_HOME);
}
if (!fs.existsSync(EDGEWORKERS_DIR)) {
  fs.mkdirSync(EDGEWORKERS_DIR);
}

export function validateTarball(ewId: string, rawTarballPath: string) {
  var tarballPath = untildify(rawTarballPath);

  // Check to make sure tarball exists
  if (!fs.existsSync(tarballPath)) {
    console.log(`ERROR: EdgeWorkers bundle archive (${tarballPath}) provided is not found.`);
    process.exit();
  }

  // Check to make sure tarball contains main.js and bundle.json at root level of archive
  let files = [];

  tar.t(
    {
      file: tarballPath,
      sync: true,
      onentry: function (entry) { files.push(entry.path); }
    },
    [MAINJS_FILENAME, MANIFEST_FILENAME] //this acts as a filter to the archive listing command
  );

  //if both files are not found throw an error and stop
  if (files.length != 2) {
    console.log(`ERROR: EdgeWorkers ${MAINJS_FILENAME} and/or ${MANIFEST_FILENAME} is not found in provided bundle tgz!`);
    process.exit();
  }

  /* DCT 8/19/19: Decided to punt on unpacking the tarball to check the individual files, thus letting the EdgeWorkers OPEN API validation catch those problems.
     However, if we wanted to do it via CLI, would need to update tar.t() command above to be tar.x() providing a local directory to unpack into, then run the
     validateManifest() function here.
  */


  // calculate checksum of new tarball
  tarballChecksum = calculateChecksum(tarballPath);

  return {
    tarballPath,
    tarballChecksum
  }
}

export function buildTarball(ewId: string, codePath: string) {
  var codeWorkingDirectory = untildify(codePath);
  var mainjsPath = path.join(codeWorkingDirectory, MAINJS_FILENAME);
  var manifestPath = path.join(codeWorkingDirectory, MANIFEST_FILENAME);

  if (!fs.existsSync(mainjsPath) || !fs.existsSync(manifestPath)) {
    console.log(`ERROR: EdgeWorkers main.js (${mainjsPath}) and/or manifest (${manifestPath}) provided is not found.`);
    process.exit();
  }

  const edgeWorkersDir = createEdgeWorkerIdDir(ewId);

  // Build tarball file name as ew_<version>_<now-as-epoch>.tgz
  var tarballFileName: string = "ew_";
  var tarballVersion: string;

  // Validate Manifest and if valid, grab version identifier
  var manifest = fs.readFileSync(manifestPath).toString();
  var manifestValidationData = validateManifest(manifest);

  if (!manifestValidationData.isValid) {
    console.log(manifestValidationData.error_reason);
    process.exit();
  }
  else {
    tarballVersion = manifestValidationData.version;
  }

  tarballFileName += tarballVersion + '_' + Date.now() + '.tgz'
  const tarballPath = path.join(edgeWorkersDir, tarballFileName);

  // tar files together with no directory structure (ie: tar czvf ../helloworld.tgz *)
  tar.c(
    {
      gzip: true,
      sync: true,
      C: codeWorkingDirectory,
      portable: true
    },
    [MAINJS_FILENAME, MANIFEST_FILENAME]
  ).pipe(fs.createWriteStream(tarballPath));

  // calculate checksum of new tarball
  tarballChecksum = calculateChecksum(tarballPath);

  return {
    tarballPath,
    tarballChecksum
  }
}

function calculateChecksum(filePath: string) {
  return sha256File(filePath);
}

function createEdgeWorkerIdDir(ewId: string) {
  const edgeWorkersDir = path.join(EDGEWORKERS_DIR, ewId);
  if (!fs.existsSync(edgeWorkersDir))
    fs.mkdirSync(edgeWorkersDir);

  return edgeWorkersDir;
}

function validateManifest(manifest: string) {
  // is file valid JSON?
  if (!cliUtils.isJSON(manifest)) {
    return {
      isValid: false,
      version: undefined,
      error_reason: `ERROR: Manifest file (${MANIFEST_FILENAME}) is not valid JSON`
    }
  }

  manifest = JSON.parse(manifest);

  var tarballVersion = manifest[TARBALL_VERSION_KEY];
  var manifestFormat = manifest[BUNDLE_FORMAT_VERSION_KEY];
  var jsAPIVersion = manifest[JSAPI_VERSION_KEY];

  // only checks the one required field is found, ignores optional fields (for now)
  if (!tarballVersion) {
    return {
      isValid: false,
      version: undefined,
      error_reason: `ERROR: Required field is missing: ${TARBALL_VERSION_KEY}`
    }
  }

  // check formatting requirements
  // validation schema per https://git.source.akamai.com/projects/EDGEWORKERS/repos/portal-ew-validation/browse/src/main/resources/manifest-schema.json
  // edgeworker-version should be a string matching "^(?!.*?\\.{2})[.a-zA-Z0-9_~-]{1,32}$"
  if (typeof tarballVersion !== 'string' || !(/^(?!.*?\\.{2})[.a-zA-Z0-9_~-]{1,32}$/.test(tarballVersion))) {
    return {
      isValid: false,
      version: undefined,
      error_reason: `ERROR: Format for field '${TARBALL_VERSION_KEY}' is invalid`
    }
  }
  // bundle-version should be an integer >=1
  if (!Number.isInteger(manifestFormat) || manifestFormat < 1) {
    return {
      isValid: false,
      version: undefined,
      error_reason: `ERROR: Format for field '${BUNDLE_FORMAT_VERSION_KEY}' is invalid`
    }
  }
  // api-version should be a string matching "^[0-9.]*$"
  if (typeof jsAPIVersion !== 'string' || !(/^[0-9.]*$/.test(jsAPIVersion))) {
    return {
      isValid: false,
      version: undefined,
      error_reason: `ERROR: Format for field '${JSAPI_VERSION_KEY}' is invalid`
    }
  }

  return {
    isValid: true,
    version: tarballVersion,
    error_reason: ""
  }
}

export function determineTarballDownloadDir(ewId: string, rawDownloadPath: string) {

  // If download path option provided, try to use it
  // If not provided, default to CLI cache directory under <CLI_CACHE_PATH>/edgeworkers-cli/edgeworkers/<ewid>/
  var downloadPath = !!rawDownloadPath ? untildify(rawDownloadPath) : createEdgeWorkerIdDir(ewId);

  // Regardless of what was picked, make sure it exists
  if (!fs.existsSync(downloadPath)) {
    console.log(`ERROR: The download path does not exist: ${downloadPath}`);
    process.exit();
  }
  console.log(`Using ${downloadPath} as path to store downloaded bundle file`);
  return downloadPath;
}
