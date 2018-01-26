import 'jest';

import * as fs from 'fs';
import * as path from 'path';

import {
  ConfigParams,
  getLoaderConfig,
  isLocalConfig,
  load,
  loadLocal,
  loadRemote,
  loadVcapServices,
  LocalLoaderConfig,
  RemoteLoaderConfig,
} from '../src/cloudFoundryConfigClient';

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
    const { uri, headers: { authorization } } = options;
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

describe("load", () => {
  test("calls loadLocal", async () => {
    const loadLocalFunc = jest.fn(config => {});
    const loaderConfig = { path: getTestYmlPath() };
    const config = await load(loaderConfig, loadLocalFunc);
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
    const config = await load(loaderConfig, null, loadRemoteFunc);
    expect(loadRemoteFunc).toBeCalledWith(loaderConfig);
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
      `./${configParams.configServerName}/${configParams.appName}-${configParams.profile}.yml`
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

function getVcapPath(): string {
  return "./test/vcap_services.json";
}

function getTestYmlPath(): string {
  return "./test/testApp-test.yml";
}
