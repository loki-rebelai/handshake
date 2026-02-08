import { loadConfig, saveConfig, getApiUrl } from '../config.js';
import { outputSuccess } from '../output.js';

export async function configSetApiUrl(url: string) {
  const config = loadConfig();
  config.apiUrl = url;
  saveConfig(config);
  outputSuccess({ apiUrl: url });
}

export async function configGetApiUrl() {
  const config = loadConfig();
  outputSuccess({ apiUrl: getApiUrl(config) });
}

export async function configResetApiUrl() {
  const config = loadConfig();
  delete config.apiUrl;
  saveConfig(config);
  outputSuccess({ apiUrl: getApiUrl(config), message: 'Reset to default' });
}
