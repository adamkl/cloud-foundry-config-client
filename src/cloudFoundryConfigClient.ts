import * as console from "console";
import * as fs from "fs";
import * as yaml from "js-yaml";
import * as path from "path";
import * as util from "util";
import fetch from "node-fetch";
import { URLSearchParams } from "url";

const EnvYamlType = new yaml.Type("!env", {
  kind: "scalar",
  construct: function (string) {
    return process.env[string];
  },
});

const SchemaWithEnv = yaml.Schema.create([EnvYamlType]);

/**
 * loads and parses VCAP_SERVICES json from process.env if possible, otherwise falls back to local vcap_servcies json file
 *
 * @export
 * @param {(string | undefined)} vcap_services contents of process.env.vcap_services
 * @param {string} [vcaplocalPath="./vcap_services.json"] local vcap_servcies file path
 * @returns
 */
export function loadVcapServices(
  vcap_services: string | undefined | null,
  vcaplocalPath = "./vcap_services.json"
) {
  if (vcap_services) {
    return JSON.parse(vcap_services || "") || {};
  } else {
    const localPath = path.resolve(process.cwd(), vcaplocalPath);
    return fs.existsSync(localPath)
      ? JSON.parse(fs.readFileSync(localPath, "utf8"))
      : {};
  }
}

/**
 * object specifying the local path of the yml file to load
 *
 * @export
 * @interface LocalLoaderConfig
 */
export interface LocalLoaderConfig {
  path: string;
}

/**
 * loads config from local yml file based on the path provided
 *
 * @export
 * @param {LocalLoaderConfig} config object containing the path of the local yml file to load
 * @returns {Promise<any>} returns config object parsed from remote yml file
 */
export async function loadLocal(config: LocalLoaderConfig): Promise<any> {
  const ymlString = await util.promisify(fs.readFile)(
    path.resolve(process.cwd(), config.path),
    "utf8"
  );
  const appConfig = yaml.safeLoad(ymlString, { schema: SchemaWithEnv });
  return appConfig;
}

/**
 * object specifying connection details of a Spring Cloud Config Server
 *
 * @export
 * @interface RemoteLoaderConfig
 */
export interface RemoteLoaderConfig {
  appName: string;
  profile: string;
  access_token_uri: string;
  uri: string;
  client_id: string;
  client_secret: string;
}

/**
 * Uses credentials pulled from VCAP_SERVICES to authenticate via OAUTH2 and pulls configuration from bound Spring Cloud Config Server based on app name and profile
 *
 * @export
 * @param {RemoteLoaderConfig} config object specifying connection details of a Spring Cloud Config Server
 * @param {any} [request=fetch] optional request object to use for making calls to config server (defaults to node-fetch)
 * @returns {Promise<any>} returns config object parsed from remote yml file
 */
export async function loadRemote(
  config: RemoteLoaderConfig,
  request = fetch
): Promise<any> {
  const {
    appName,
    profile,
    uri,
    access_token_uri,
    client_id,
    client_secret,
  } = config;
  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", client_id);
  params.append("client_secret", client_secret);
  let response = await request(access_token_uri, {
    method: "POST",
    body: params,
  });
  const { access_token } = await response.json();
  response = await request(getYmlUri(uri, appName, profile), {
    headers: {
      authorization: `bearer ${access_token}`,
    },
  });
  const ymlString = await response.text();
  return yaml.safeLoad(ymlString);
}

/**
 * object specifying connection details of a Spring Cloud Config Server
 * but skipping the authorization step
 *
 * @export
 * @interface RemoteSkipAuthLoaderConfig
 */
export interface RemoteSkipAuthLoaderConfig {
  appName: string;
  profile: string;
  uri: string;
}

/**
 * Pulls configuration from bound Spring Cloud Config Server based on app name and profile
 * This method skips the authentication step
 *
 * @export
 * @param {RemoteSkipAuthLoaderConfig} config object specifying connection details of a Spring Cloud Config Server
 * @param {any} [request=fetch] optional request object to use for making calls to config server (defaults to node-fetch)
 * @returns {Promise<any>} returns config object parsed from remote yml file
 */
export async function loadRemoteSkipAuth(
  config: RemoteSkipAuthLoaderConfig,
  request = fetch
): Promise<any> {
  const { appName, profile, uri } = config;
  const response = await request(getYmlUri(uri, appName, profile));
  const ymlString = await response.text();
  return yaml.safeLoad(ymlString);
}

function getYmlUri(uri: string, appName: string, profile: string) {
  return `${uri}/${appName}-${profile}.yml`;
}

export type LoaderConfig =
  | LocalLoaderConfig
  | RemoteLoaderConfig
  | RemoteSkipAuthLoaderConfig;
/**
 * Tests to see if provided LoaderConfig is a LocalLoaderConfig
 *
 * @export
 * @param {LoaderConfig} config
 * @returns {config is LocalLoaderConfig}
 */
export function isLocalConfig(
  config: LoaderConfig
): config is LocalLoaderConfig {
  return (<LocalLoaderConfig>config).path !== undefined;
}

/**
 * Tests to see if provided LoaderConfig is a RemoteLoaderConfig
 *
 * @export
 * @param {LoaderConfig} config
 * @returns {config is RemoteLoaderConfig}
 */
export function isRemoteConfig(
  config: LoaderConfig
): config is RemoteLoaderConfig {
  return (
    (<RemoteLoaderConfig>config).access_token_uri !== undefined &&
    (<RemoteLoaderConfig>config).client_id !== undefined &&
    (<RemoteLoaderConfig>config).client_secret !== undefined
  );
}

/**
 * Loads configuration from either remote or local location based on provided configuration object
 *
 * @export
 * @param {LoaderConfig} config Object containing parameters to use for loading configuration
 * @param {any} [loadLocalFunc=loadLocal] function responsible for loading local yml file
 * @param {any} [loadRemoteFunc=loadRemote] function responsible for loading config from Spring Cloud Config Server
 * @param {any} [loadRemoteSkipAuthFunc=loadRemoteSkipAuth] function responsible for loading config from
 * Spring Cloud Config Server skipping the authorization step
 * @returns {Promise<any>} returns loaded configuration object
 */
export async function load(
  config: LoaderConfig,
  params: ConfigParams,
  loadLocalFunc = loadLocal,
  loadRemoteFunc = loadRemote,
  loadRemoteSkipAuthFunc = loadRemoteSkipAuth
): Promise<any> {
  let appConfig;
  if (isLocalConfig(config)) {
    appConfig = await loadLocalFunc(config);
  } else if (isRemoteConfig(config)) {
    appConfig = await loadRemoteFunc(config);
  } else {
    appConfig = await loadRemoteSkipAuthFunc(config);
  }
  const {
    appName,
    configServerName,
    configLocation,
    profile,
    logProperties,
  } = params;
  console.debug(
    `Settings loaded from ${configLocation} ${configServerName} for ${appName}-${profile}`
  );
  if (logProperties) {
    console.debug("--------------------------------");
    console.debug(JSON.stringify(appConfig, null, 2));
  }
  return appConfig;
}

export type ConfigLocation = "local" | "remote" | "remoteSkipAuth";

const configServerServiceNameValues = ["p-config-server", "p.config-server"];

/**
 * Generated appropriate loader config file based on whether configuration is to be loaded locally or remotely
 *
 * @export
 * @param {ConfigParams} params contains parameters used to load correct configuration
 * @returns {LoaderConfig} either a LocalLoaderConfig or a RemoteLoaderConfig
 */
export function getLoaderConfig(
  params: ConfigParams,
  loadVcapServicesFunc = loadVcapServices
): LoaderConfig {
  const { appName, profile, configServerName, configLocation } = params;
  let loaderConfig: LoaderConfig;
  if (configLocation === "remote") {
    const vcap_services = loadVcapServicesFunc(process.env.VCAP_SERVICES);
    const configServerServiceName = configServerServiceNameValues.find(
      (configServerServiceName) =>
        vcap_services.hasOwnProperty(configServerServiceName)
    );
    if (!configServerServiceName) {
      throw new Error(
        `Either ${configServerServiceNameValues.join(
          " or "
        )} must be defined on VCAP_SERVICES`
      );
    }
    const { credentials } = vcap_services[`${configServerServiceName}`].find(
      (cfg) => cfg.name === configServerName
    );
    loaderConfig = {
      appName,
      profile,
      ...credentials,
    } as RemoteLoaderConfig;
  } else if (configLocation == "remoteSkipAuth") {
    const uri = process.env.CONFIG_SERVER_URI_WHEN_SKIP_AUTH;
    loaderConfig = {
      appName,
      profile,
      uri,
    } as RemoteSkipAuthLoaderConfig;
  } else {
    loaderConfig = {
      path: `./${configServerName}/${appName}-${profile}.yml`,
    } as LocalLoaderConfig;
  }
  return loaderConfig;
}

/**
 * Wraps config load call inside optional setInterval for auto-updating
 * @param config
 * @param params
 * @param updateFunc
 * @param loadLocalFunc
 * @param loadRemoteFunc
 */
export async function loadAndRepeat(
  config,
  params,
  updateFunc,
  loadLocalFunc = loadLocal,
  loadRemoteFunc = loadRemote
) {
  updateFunc(await load(config, params, loadLocalFunc, loadRemoteFunc));

  const { interval } = params;
  if (interval) {
    console.debug(
      `set to auto-refresh config with interval of ${interval} seconds`
    );
    setInterval(async () => {
      try {
        console.debug(
          `auto-refreshing config after waiting ${interval} seconds`
        );
        updateFunc(await load(config, params, loadLocalFunc, loadRemoteFunc));
      } catch (err) {
        console.debug(
          `Problem encountered while refreshing config; using previous config: ${err}`
        );
      }
    }, interval * 1000);
  }
}

/**
 * contains required parameters for loading application configuration
 *
 * @export
 * @interface ConfigParams
 */
export interface ConfigParams {
  appName: string;
  profile: string;
  configServerName: string;
  configLocation: ConfigLocation;
  logProperties?: boolean;
  interval?: number;
}

/**
 * Config class contains the global app configuration once loaded
 *
 * @export
 * @class Config
 */
export class Config {
  /**
   * the currently loaded app config
   *
   * @static
   * @type {*}
   * @memberof Config
   */
  public static current: any;
  /**
   * loads the app config *must be called during the start of the application*
   *
   * @static
   * @param {ConfigParams} params
   * @returns {Promise<void>}
   * @memberof Config
   */
  public static async load(params: ConfigParams): Promise<void> {
    const config = getLoaderConfig(params);
    await loadAndRepeat(config, params, (loadedConfig) => {
      this.current = loadedConfig;
    });
  }
}
