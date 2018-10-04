import * as console from "console";
import * as fs from "fs";
import * as yaml from "js-yaml";
import * as path from "path";
import * as rp from "request-promise-native";
import * as util from "util";

const EnvYamlType = new yaml.Type("!env", {
  kind: "scalar",
  construct: function(string) {
    return process.env[string];
  }
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
  vcap_services: string | undefined,
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
  log_properties: boolean;
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
  if(config.log_properties) console.debug(ymlString);
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
  log_properties: boolean;
}

/**
 * Uses credentials pulled from VCAP_SERVICES to authenticate via OAUTH2 and pulls configuration from bound Spring Cloud Config Server based on app name and profile
 *
 * @export
 * @param {RemoteLoaderConfig} config object specifying connection details of a Spring Cloud Config Server
 * @param {any} [request=rp] optional request object to use for making calls to config server (defaults to request-promise-native)
 * @returns {Promise<any>} returns config object parsed from remote yml file
 */
export async function loadRemote(
  config: RemoteLoaderConfig,
  request = rp
): Promise<any> {
  const {
    appName,
    profile,
    uri,
    access_token_uri,
    client_id,
    client_secret,
    log_properties
  } = config;
  const response = await request.post(access_token_uri, {
    form: { grant_type: "client_credentials", client_id, client_secret }
  });
  const { access_token } = JSON.parse(response);
  const ymlString = await request.get({
    uri: `${uri}/${appName}-${profile}.yml`,
    headers: {
      authorization: `bearer ${access_token}`
    }
  });
  if (log_properties) console.debug(ymlString);
  return yaml.safeLoad(ymlString);
}

export type LoaderConfig = LocalLoaderConfig | RemoteLoaderConfig;
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
 * Loads configuration from either remote or local location based on provided configuration object
 *
 * @export
 * @param {LoaderConfig} config Object containing parameters to use for loading configuration
 * @param {any} [loadLocalFunc=loadLocal] function responsible for loading local yml file
 * @param {any} [loadRemoteFunc=loadRemote] function responsible for loading config from Spring Cloud Config Server
 * @returns {Promise<any>} returns loaded configuration object
 */
export async function load(
  config: LoaderConfig,
  loadLocalFunc = loadLocal,
  loadRemoteFunc = loadRemote
): Promise<any> {
  if (isLocalConfig(config)) {
    return await loadLocalFunc(config);
  } else {
    return await loadRemoteFunc(config);
  }
}

export type ConfigLocation = "local" | "remote";

/**
 * Generated appropriate loader config file based on whether configuration is to be loaded locally or remotely
 *
 * @export
 * @param {ConfigParams} params contains paramters used to load correct configuration
 * @returns {LoaderConfig} either a LocalLoaderConfig or a RemoteLoaderConfig
 */
export function getLoaderConfig(
  params: ConfigParams,
  loadVcapServicesFunc = loadVcapServices
): LoaderConfig {
  const { appName, profile, configServerName, configLocation } = params;
  const vcap_services = loadVcapServicesFunc(process.env.VCAP_SERVICES);
  let loaderConfig: LoaderConfig;
  if (configLocation === "remote") {
    const { credentials } = vcap_services["p-config-server"].find(
      cfg => cfg.name === configServerName
    );
    loaderConfig = {
      appName,
      profile,
      ...credentials
    };
  } else {
    loaderConfig = {
      path: `./${configServerName}/${appName}-${profile}.yml`
    };
  }
  return loaderConfig;
}

/**
 * contains required paramters for loading application configuration
 *
 * @export
 * @interface ConfigParams
 */
export interface ConfigParams {
  appName: string;
  profile: string;
  configServerName: string;
  configLocation: ConfigLocation;
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
    this.current = await load(config);
  }
}
