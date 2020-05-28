import "jest";

import * as fs from "fs";
import * as path from "path";

import * as console from "console";
import nock from "nock";

jest.useFakeTimers();
jest.mock("console", () => {
  return { debug: jest.fn() };
});

import {
  Config,
  ConfigParams,
  getLoaderConfig,
  isLocalConfig,
  isRemoteConfig,
  loadAndRepeat,
  load,
  loadLocal,
  loadRemote,
  loadRemoteSkipAuth,
  loadVcapServices,
  LocalLoaderConfig,
  RemoteLoaderConfig,
  RemoteSkipAuthLoaderConfig,
} from "../src/cloudFoundryConfigClient";

const P_CONFIG_SERVER_SERVICE_NAME_HYPHEN = "p-config-server";
const P_CONFIG_SERVER_SERVICE_NAME_DOT = "p.config-server";
const P_CONFIG_SERVER_SERVICE_NAME_INVALID = "invalid";

beforeEach(() => {
  (console as any).debug.mockClear();
});

describe("node-fetch", () => {});

describe("loadVcapServices", () => {
  test("loads local file if vcap_services is undefined", () => {
    const vcap_services: string = undefined;
    const output = loadVcapServices(
      vcap_services,
      getVcapPath(P_CONFIG_SERVER_SERVICE_NAME_HYPHEN)
    );
    expect(output).toEqual({
      "p-config-server": [
        {
          credentials: {
            uri: "local.config",
            client_secret: "secret",
            client_id: "id",
            access_token_uri: "local.token",
          },
          name: "test-config",
        },
      ],
    });
  });

  test("loads local file if vcap_services is null", () => {
    const vcap_services: string = null;
    const output = loadVcapServices(
      vcap_services,
      getVcapPath(P_CONFIG_SERVER_SERVICE_NAME_HYPHEN)
    );
    expect(output).toEqual({
      "p-config-server": [
        {
          credentials: {
            uri: "local.config",
            client_secret: "secret",
            client_id: "id",
            access_token_uri: "local.token",
          },
          name: "test-config",
        },
      ],
    });
  });

  test("loads local file if vcap_services is empty", () => {
    const vcap_services: string = "";
    const output = loadVcapServices(
      vcap_services,
      getVcapPath(P_CONFIG_SERVER_SERVICE_NAME_HYPHEN)
    );
    expect(output).toEqual({
      "p-config-server": [
        {
          credentials: {
            uri: "local.config",
            client_secret: "secret",
            client_id: "id",
            access_token_uri: "local.token",
          },
          name: "test-config",
        },
      ],
    });
  });

  test("loads string from vcap_services if present", () => {
    const vcap_services: string = `{
      "p-config-server": [
        {
          "credentials": {
            "uri": "process.env.config",
            "client_secret": "secret",
            "client_id": "id",
            "access_token_uri": "process.env.token"
          },
          "name": "test-config"
        }
      ]
    }`;
    const output = loadVcapServices(vcap_services);
    expect(output).toEqual({
      "p-config-server": [
        {
          credentials: {
            uri: "process.env.config",
            client_secret: "secret",
            client_id: "id",
            access_token_uri: "process.env.token",
          },
          name: "test-config",
        },
      ],
    });
  });
});

describe("isLocalConfig", () => {
  test("returns true if LoaderConfig is LocalLoaderConfig", () => {
    const loaderConfig: LocalLoaderConfig = {
      path: "./testApp-test.yml",
    };
    const output = isLocalConfig(loaderConfig);
    expect(output).toBe(true);
  });
  test("returns false if LoaderConfig is not LocalLoaderConfig", () => {
    const loaderConfig: RemoteLoaderConfig = {
      appName: "testApp",
      profile: "test",
      uri: "http://test.config",
      access_token_uri: "http://test.token",
      client_id: "id",
      client_secret: "secret",
    };
    const output = isLocalConfig(loaderConfig);
    expect(output).toBe(false);
  });
});

describe("isRemoteConfig", () => {
  test("returns true if LoaderConfig is RemoteLoaderConfig", () => {
    const loaderConfig: RemoteLoaderConfig = {
      appName: "testApp",
      profile: "test",
      uri: "http://test.config",
      access_token_uri: "http://test.token",
      client_id: "id",
      client_secret: "secret",
    };
    const output = isRemoteConfig(loaderConfig);
    expect(output).toBe(true);
  });
  test("returns false if LoaderConfig is not RemoteLoaderConfig", () => {
    const loaderConfig: LocalLoaderConfig = {
      path: "./testApp-test.yml",
    };
    const output = isRemoteConfig(loaderConfig);
    expect(output).toBe(false);
  });
});

describe("loadLocal", () => {
  test("loads local file if present", async () => {
    const config = await loadLocal({ path: getTestYmlPath() });
    expect(config).toEqual({
      "test-app": {
        host: "www.test.com",
        port: "443",
        ssl: "true",
      },
    });
  });
  test("throws exception if local file is missing", async () => {
    await expect(
      loadLocal({ path: "./missing/testApp-test.yml" })
    ).rejects.toBeDefined();
  });
});

describe("loadRemote", () => {
  const loaderConfig: RemoteLoaderConfig = {
    appName: "testApp",
    profile: "test",
    uri: "http://test.config",
    access_token_uri: "http://test.token",
    client_id: "id",
    client_secret: "secret",
  };
  const request = jest.fn();
  request.mockImplementationOnce(async (uri, options) => {
    expect(uri).toEqual(loaderConfig.access_token_uri);
    const client_id = options.body.get("client_id");
    const client_secret = options.body.get("client_secret");
    expect(client_id).toEqual(loaderConfig.client_id);
    expect(client_secret).toEqual(loaderConfig.client_secret);
    return new Promise((resolve) => {
      resolve({
        json: () =>
          new Promise((resolve) =>
            resolve({
              access_token: "test_token",
            })
          ),
      });
    });
  });
  request.mockImplementationOnce(async (uri, options) => {
    const {
      headers: { authorization },
    } = options;
    expect(uri).toEqual(
      `${loaderConfig.uri}/${loaderConfig.appName}-${loaderConfig.profile}.yml`
    );
    expect(authorization).toEqual("bearer test_token");
    const ymlString = fs.readFileSync(
      path.resolve(process.cwd(), getTestYmlPath()),
      "utf8"
    );
    return new Promise((resolve) => {
      resolve({
        text: () => new Promise((resolve) => resolve(ymlString)),
      });
    });
  });
  test("posts oauth request and returns config from remote source", async () => {
    const config = await loadRemote(loaderConfig, request);
    expect(config).toEqual({
      "test-app": {
        host: "www.test.com",
        port: "443",
        ssl: "true",
      },
    });
  });
});

describe("loadRemoteSkipAuth", () => {
  const loaderConfig: RemoteSkipAuthLoaderConfig = {
    appName: "testApp",
    profile: "test",
    uri: "http://test.config",
  };
  const request = jest.fn(async (uri) => {
    expect(uri).toEqual(
      `${loaderConfig.uri}/${loaderConfig.appName}-${loaderConfig.profile}.yml`
    );
    const ymlString = fs.readFileSync(
      path.resolve(process.cwd(), getTestYmlPath()),
      "utf8"
    );
    return new Promise((resolve) => {
      resolve({
        text: () => new Promise((resolve) => resolve(ymlString)),
      });
    });
  });
  test("returns config from remote source skipping the authentication step", async () => {
    const config = await loadRemoteSkipAuth(loaderConfig, request);
    expect(config).toEqual({
      "test-app": {
        host: "www.test.com",
        port: "443",
        ssl: "true",
      },
    });
  });
});

describe("loadAndRepeat", () => {
  test("calls updateFunc once", async () => {
    const updateFunc = jest.fn();
    const loadLocalFunc = jest.fn();
    const loaderConfig = { path: getTestYmlPath() };
    const params = {} as any;
    await loadAndRepeat(loaderConfig, params, updateFunc, loadLocalFunc);
    expect(updateFunc).toBeCalled();
    expect(updateFunc).toHaveBeenCalledTimes(1);
  });
  test("calls updateFunc 5 times", async () => {
    const updateFunc = jest.fn();
    const loadLocalFunc = jest.fn();
    const loaderConfig = { path: getTestYmlPath() };
    const params = { interval: 1 } as any;
    await loadAndRepeat(loaderConfig, params, updateFunc, loadLocalFunc);
    for (let i = 0; i < 4; i++) {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    }
    expect(console.debug).toHaveBeenCalledWith(
      `set to auto-refresh config with interval of ${params.interval} seconds`
    );
    expect(console.debug).toHaveBeenCalledWith(
      `auto-refreshing config after waiting ${params.interval} seconds`
    );
    expect(updateFunc).toHaveBeenCalledTimes(5);
  });

  test("updates config on interval", async () => {
    let current = undefined;
    const updateFunc = jest.fn((newConfig) => {
      current = newConfig;
    });
    const loadedConfig1 = {
      "test-app": {
        host: "www.test.com",
        port: "443",
        ssl: "true",
      },
    };
    const loadedConfig2 = {
      "test-app": {
        host: "www.test.com",
        port: "443",
        ssl: "true",
        newFeature1: true,
      },
    };

    const loadLocalFunc = jest.fn();
    loadLocalFunc
      .mockReturnValueOnce(loadedConfig1)
      .mockReturnValue(loadedConfig2);

    const loaderConfig = { path: getTestYmlPath() };
    const params = { interval: 1 } as any;
    await loadAndRepeat(loaderConfig, params, updateFunc, loadLocalFunc);

    expect(current).toEqual(loadedConfig1);

    jest.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(current).toEqual(loadedConfig2);
  });

  test("logs error on refresh; uses previous config", async () => {
    let current = undefined;
    const updateFunc = jest.fn((newConfig) => {
      current = newConfig;
    });
    const loadedConfig = {
      "test-app": {
        host: "www.test.com",
        port: "443",
        ssl: "true",
      },
    };
    const error = new Error("error loading local config");
    const loadLocalFunc = jest.fn();
    loadLocalFunc.mockReturnValueOnce(loadedConfig).mockRejectedValue(error);

    const loaderConfig = { path: getTestYmlPath() };
    const params = { interval: 1 } as any;
    await loadAndRepeat(loaderConfig, params, updateFunc, loadLocalFunc);
    for (let i = 0; i < 4; i++) {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    }
    expect(console.debug).toHaveBeenCalledWith(
      `Problem encountered while refreshing config; using previous config: ${error}`
    );
    expect(current).toEqual(loadedConfig);
  });
});

describe("load", () => {
  test("calls loadLocal", async () => {
    const loadLocalFunc = jest.fn((config) => {});
    const loaderConfig = { path: getTestYmlPath() };
    const config = await load(loaderConfig, {} as any, loadLocalFunc);
    expect(loadLocalFunc).toBeCalledWith(loaderConfig);
  });
  test("calls loadRemote", async () => {
    const loadRemoteFunc = jest.fn((config) => {});
    const loaderConfig: RemoteLoaderConfig = {
      appName: "testApp",
      profile: "test",
      uri: "http://test.config",
      access_token_uri: "http://test.token",
      client_id: "id",
      client_secret: "secret",
    };
    const config = await load(loaderConfig, {} as any, null, loadRemoteFunc);
    expect(loadRemoteFunc).toBeCalledWith(loaderConfig);
  });
  test("calls loadRemoteSkipAuth", async () => {
    const loadRemoteSkipAuthFunc = jest.fn((config) => {});
    const loaderConfig: RemoteSkipAuthLoaderConfig = {
      appName: "testApp",
      profile: "test",
      uri: "http://test.config",
    };
    const config = await load(
      loaderConfig,
      {} as any,
      null,
      null,
      loadRemoteSkipAuthFunc
    );
    expect(loadRemoteSkipAuthFunc).toBeCalledWith(loaderConfig);
  });
  describe("with logging off", () => {
    test("does not log to console", async () => {
      const loadLocalFunc = jest.fn((config) => {});
      const loaderConfig = { path: getTestYmlPath() };
      const config = await load(
        loaderConfig,
        { logProperties: false } as any,
        loadLocalFunc
      );
      expect(console.debug).toHaveBeenCalledTimes(1);
    });
  });
  describe("with logging on", () => {
    test("does log to console", async () => {
      const loadLocalFunc = jest.fn((config) => {});
      const loaderConfig = { path: getTestYmlPath() };
      const config = await load(
        loaderConfig,
        { logProperties: true } as any,
        loadLocalFunc
      );
      expect(console.debug).toHaveBeenCalledTimes(3);
    });
  });
});

describe("getLoaderConfig", () => {
  const loadVcapServicesFunc = (vcap_services) => {
    return loadVcapServices(
      vcap_services,
      getVcapPath(P_CONFIG_SERVER_SERVICE_NAME_HYPHEN)
    );
  };
  test("returns LocalLoaderConfig", async () => {
    const configParams: ConfigParams = {
      appName: "testApp",
      profile: "test",
      configServerName: "test-config",
      configLocation: "local",
    };
    const loaderConfig = await getLoaderConfig(
      configParams,
      loadVcapServicesFunc
    );
    const { path } = <LocalLoaderConfig>loaderConfig;
    expect(path).toEqual(
      `./${configParams.configServerName}/${configParams.appName}-${configParams.profile}.yml`
    );
  });
  test(`returns RemoteLoaderConfig with vcap_services_${P_CONFIG_SERVER_SERVICE_NAME_HYPHEN}.json`, async () => {
    const configParams: ConfigParams = {
      appName: "testApp",
      profile: "test",
      configServerName: "test-config",
      configLocation: "remote",
    };
    const loaderConfig = await getLoaderConfig(
      configParams,
      loadVcapServicesFunc
    );
    const {
      appName,
      profile,
      uri,
      access_token_uri,
      client_id,
      client_secret,
    } = <RemoteLoaderConfig>loaderConfig;
    expect(appName).toEqual(configParams.appName);
    expect(profile).toEqual(configParams.profile);
    expect(uri).toEqual("local.config");
    expect(access_token_uri).toEqual("local.token");
    expect(client_id).toEqual("id");
    expect(client_secret).toEqual("secret");
  });
  test("returns RemoteSkipAuthLoaderConfig", async () => {
    process.env["CONFIG_SERVER_URI_WHEN_SKIP_AUTH"] = "http://localhost:8888";
    const configParams: ConfigParams = {
      appName: "testApp",
      profile: "test",
      configServerName: "test-config",
      configLocation: "remoteSkipAuth",
    };
    const loaderConfig = await getLoaderConfig(
      configParams,
      loadVcapServicesFunc
    );
    const { appName, profile, uri } = <RemoteSkipAuthLoaderConfig>loaderConfig;
    expect(appName).toEqual(configParams.appName);
    expect(profile).toEqual(configParams.profile);
    expect(uri).toEqual("http://localhost:8888");
  });
  test(`returns RemoteLoaderConfig with vcap_services_${P_CONFIG_SERVER_SERVICE_NAME_DOT}.json`, async () => {
    const loadVcapServicesFuncWithDot = (vcap_services) => {
      return loadVcapServices(
        vcap_services,
        getVcapPath(P_CONFIG_SERVER_SERVICE_NAME_DOT)
      );
    };
    const configParams: ConfigParams = {
      appName: "testApp",
      profile: "test",
      configServerName: "test-config",
      configLocation: "remote",
    };
    const loaderConfig = await getLoaderConfig(
      configParams,
      loadVcapServicesFuncWithDot
    );
    const {
      appName,
      profile,
      uri,
      access_token_uri,
      client_id,
      client_secret,
    } = <RemoteLoaderConfig>loaderConfig;
    expect(appName).toEqual(configParams.appName);
    expect(profile).toEqual(configParams.profile);
    expect(uri).toEqual("local.config");
    expect(access_token_uri).toEqual("local.token");
    expect(client_id).toEqual("id");
    expect(client_secret).toEqual("secret");
  });
  test("throws an exception instead of a RemoteLoaderConfig with an invalid vcap_services", async () => {
    const loadVcapServicesFuncInvalid = (vcap_services) => {
      return loadVcapServices(
        vcap_services,
        getVcapPath(P_CONFIG_SERVER_SERVICE_NAME_INVALID)
      );
    };
    const configParams: ConfigParams = {
      appName: "testApp",
      profile: "test",
      configServerName: "test-config",
      configLocation: "remote",
    };
    let error;
    try {
      await getLoaderConfig(configParams, loadVcapServicesFuncInvalid);
    } catch (e) {
      error = e;
    }
    expect(error).toEqual(
      new Error(
        `Either ${P_CONFIG_SERVER_SERVICE_NAME_HYPHEN} or ${P_CONFIG_SERVER_SERVICE_NAME_DOT} must be defined on VCAP_SERVICES`
      )
    );
  });
});

describe("Config.load", () => {
  test("local e2e", async () => {
    const configParams: ConfigParams = {
      appName: "testApp",
      profile: "test",
      configServerName: "test-config",
      configLocation: "local",
    };

    await Config.load(configParams);

    expect(Config.current).toEqual({
      "test-app": {
        host: "www.test.com",
        port: "443",
        ssl: "true",
      },
    });
  });

  test("remote e2e-ish", async () => {
    process.env.VCAP_SERVICES = JSON.stringify({
      "p.config-server": [
        {
          credentials: {
            uri: "https://local.config",
            client_secret: "secret",
            client_id: "id",
            access_token_uri: "https://local.token",
          },
          name: "test-config",
        },
      ],
    });

    const configParams: ConfigParams = {
      appName: "testApp",
      profile: "test",
      configServerName: "test-config",
      configLocation: "remote",
    };

    const token_scope = nock("https://local.token").post("/").reply(200, {
      access_token: "1234",
    });

    const config_scope = nock("https://local.config")
      .get(`/${configParams.appName}-${configParams.profile}.yml`)
      .replyWithFile(200, path.resolve(process.cwd(), getTestYmlPath()));

    await Config.load(configParams);

    expect(Config.current).toEqual({
      "test-app": {
        host: "www.test.com",
        port: "443",
        ssl: "true",
      },
    });

    process.env.VCAP_SERVICES = undefined;
  });
});

function getVcapPath(suffixFileName: string): string {
  return `./test/vcap_services_${suffixFileName}.json`;
}

function getTestYmlPath(): string {
  return "./test-config/testApp-test.yml";
}
