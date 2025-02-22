var EdgeGrid = require('edgegrid');
import * as os from 'os';

var path = require('path');
import * as edgeRcParser from './edgerc-parser';

const _edge = null;
const edgeRcParams = {
  section: process.env.AKAMAI_EDGERC_SECTION || 'default',
  path: process.env.AKAMAI_EDGERC || path.resolve(os.homedir(), '.edgerc'),
  debug: false
};

function getEdgeGridSection(section) {
  var sections = edgeRcParser.parseEdgeGridToSectionArray(edgeRcParams.path);
  return sections.find(s => s.sectionName === section);
}

function getAllEdgeGridSections() {
  return edgeRcParser.parseEdgeGridToSectionArray(edgeRcParams.path);
}

export function getEdgeGrid() {
  if (_edge != null) {
    return _edge;
  }
  var s = getEdgeGridSection(edgeRcParams.section);
  return new EdgeGrid(s.clientToken, s.clientSecret, s.accessToken, s.host, edgeRcParams.debug);
}

export function setDebugMode(debug: boolean) {
  edgeRcParams.debug = debug;
}

export function setEdgeRcSection(section: string) {
  edgeRcParams.section = section;
}

export function setEdgeRcFilePath(path: string) {
  edgeRcParams.path = path;
}

export function isDebugMode() {
  return edgeRcParams.debug;
}

export function getNodeVersion() {
  return parseInt(process.versions["node"].split('.')[0]);
}
