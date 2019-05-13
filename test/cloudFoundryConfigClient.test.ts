import "jest";

import * as fs from "fs";
import * as path from "path";

import * as console from "console";

jest.useFakeTimers();
jest.mock("console", () => {
  return { debug: jest.fn() };
});

import {
  Config,
  ConfigParams,
  getLoaderConfig,
  isLocalConfig,
  loadAndRepeat,
  load,
  loadLocal,
  loadRemote,
  loadVcapServices,
  LocalLoaderConfig,
  RemoteLoaderConfig
} from "../src/cloudFoundryConfigClient";

beforeEach(() => {
  (console as any).debug.mockClear();
});

describe("loadVcapServices", () => {
  test("loads local file if vcap_services is undefined", () => {
    const vcap_services: string = undefined;
    const output = loadVcapServices(vcap_services, getVcapPath());
    expect(output).toEqual({
      "p-config-server": [
        {
          credentials: {
            uri: "local.config",
            client_secret: "secret",
            client_id: "id",
            access_token_uri: "local.token"
          },
          name: "test-config"
        }
      ]
    });
  });

  test("loads local file if vcap_services is null", () => {
    const vcap_services: string = null;
    const output = loadVcapServices(vcap_services, getVcapPath());
    expect(output).toEqual({
      "p-config-server": [
        {
          credentials: {
            uri: "local.config",
            client_secret: "secret",
            client_id: "id",
            access_token_uri: "local.token"
          },
          name: "test-config"
        }
      ]
    });
  });

  test("loads local file if vcap_services is empty", () => {
    const vcap_services: string = "";
    const output = loadVcapServices(vcap_services, getVcapPath());
    expect(output).toEqual({
      "p-config-server": [
        {
          credentials: {
            uri: "local.config",
            client_secret: "secret",
            client_id: "id",
            access_token_uri: "local.token"
          },
          name: "test-config"
        }
      ]
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
            access_token_uri: "process.env.token"
          },
          name: "test-config"
        }
      ]
    });
  });
});

describe("isLocalConfig", () => {
  test("returns true if LoaderConfig is LocalLoaderConfig", () => {
    const loaderConfig: LocalLoaderConfig = {
      path: "./testApp-test.yml"
    };
    const output = isLocalConfig(loaderConfig);
    expect(output).toBe(true);
  });
  test("returns false if LoaderConfig is LocalLoaderConfig", () => {
    const loaderConfig: RemoteLoaderConfig = {
      appName: "testApp",
      profile: "test",
      uri: "http://test.config",
      access_token_uri: "http://test.token",
      client_id: "id",
      client_secret: "secret"
    };
    const output = isLocalConfig(loaderConfig);
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
        ssl: "true"
      }
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
    client_secret: "secret"
  };
  const post = jest.fn(async (uri, options) => {
    expect(uri).toEqual(loaderConfig.access_token_uri);
    const { client_id, client_secret } = options.form;
    expect(client_id).toEqual(loaderConfig.client_id);
    expect(client_secret).toEqual(loaderConfig.client_secret);
    return new Promise(resolve => {
      resolve(`{
      "access_token": "test_token"
    }`);
    });
  });
  const get = jest.fn(async options => {
    const {
      uri,
      headers: { authorization }
    } = options;
    expect(uri).toEqual(
      `${loaderConfig.uri}/${loaderConfig.appName}-${loaderConfig.profile}.yml`
    );
    expect(authorization).toEqual("bearer test_token");
    const ymlString = fs.readFileSync(
      path.resolve(process.cwd(), getTestYmlPath()),
      "utf8"
    );
    return new Promise(resolve => {
      resolve(ymlString);
    });
  });
  const request = {
    post,
    get
  };
  test("posts oauth request and returns config from remote source", async () => {
    const config = await loadRemote(loaderConfig, request);
    expect(config).toEqual({
      "test-app": {
        host: "www.test.com",
        port: "443",
        ssl: "true"
      }
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
    const updateFunc = jest.fn(newConfig => {
      current = newConfig;
    });
    const loadedConfig1 = {
      "test-app": {
        host: "www.test.com",
        port: "443",
        ssl: "true"
      }
    };
    const loadedConfig2 = {
      "test-app": {
        host: "www.test.com",
        port: "443",
        ssl: "true",
        newFeature1: true
      }
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
    const updateFunc = jest.fn(newConfig => {
      current = newConfig;
    });
    const loadedConfig = {
      "test-app": {
        host: "www.test.com",
        port: "443",
        ssl: "true"
      }
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
    const loadLocalFunc = jest.fn(config => {});
    const loaderConfig = { path: getTestYmlPath() };
    const config = await load(loaderConfig, {} as any, loadLocalFunc);
    expect(loadLocalFunc).toBeCalledWith(loaderConfig);
  });
  test("calls loadRemote", async () => {
    const loadRemoteFunc = jest.fn(config => {});
    const loaderConfig: RemoteLoaderConfig = {
      appName: "testApp",
      profile: "test",
      uri: "http://test.config",
      access_token_uri: "http://test.token",
      client_id: "id",
      client_secret: "secret"
    };
    const config = await load(loaderConfig, {} as any, null, loadRemoteFunc);
    expect(loadRemoteFunc).toBeCalledWith(loaderConfig);
  });
  describe("with logging off", () => {
    test("does not log to console", async () => {
      const loadLocalFunc = jest.fn(config => {});
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
      const loadLocalFunc = jest.fn(config => {});
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
  const loadVcapServicesFunc = vcap_services => {
    return loadVcapServices(vcap_services, "./test/vcap_services.json");
  };
  test("returns LocalLoaderConfig", async () => {
    const configParams: ConfigParams = {
      appName: "testApp",
      profile: "test",
      configServerName: "test-config",
      configLocation: "local"
    };
    const loaderConfig = await getLoaderConfig(
      configParams,
      loadVcapServicesFunc
    );
    const { path } = <LocalLoaderConfig>loaderConfig;
    expect(path).toEqual(
      `./${configParams.configServerName}/${configParams.appName}-${
        configParams.profile
      }.yml`
    );
  });
  test("returns RemoteLoaderConfig", async () => {
    const configParams: ConfigParams = {
      appName: "testApp",
      profile: "test",
      configServerName: "test-config",
      configLocation: "remote"
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
      client_secret
    } = <RemoteLoaderConfig>loaderConfig;
    expect(appName).toEqual(configParams.appName);
    expect(profile).toEqual(configParams.profile);
    expect(uri).toEqual("local.config");
    expect(access_token_uri).toEqual("local.token");
    expect(client_id).toEqual("id");
    expect(client_secret).toEqual("secret");
  });
});

describe("Config.load", () => {
  test("local e2e", async () => {
    const configParams: ConfigParams = {
      appName: "testApp",
      profile: "test",
      configServerName: "test-config",
      configLocation: "local"
    };

    await Config.load(configParams);

    expect(Config.current).toEqual({
      "test-app": {
        host: "www.test.com",
        port: "443",
        ssl: "true"
      }
    });
  });
});

function getVcapPath(): string {
  return "./test/vcap_services.json";
}

function getTestYmlPath(): string {
  return "./test-config/testApp-test.yml";
}
