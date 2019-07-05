# cloud-foundry-config-client

[![Greenkeeper badge](https://badges.greenkeeper.io/adamkl/cloud-foundry-config-client.svg)](https://greenkeeper.io/)
[![npm version](https://badge.fury.io/js/cloud-foundry-config-client.svg)](https://badge.fury.io/js/cloud-foundry-config-client)
[![Build Status](https://travis-ci.org/adamkl/cloud-foundry-config-client.svg?branch=master)](https://travis-ci.org/adamkl/cloud-foundry-config-client)

A simple client for pulling configuration from a PCF Spring Cloud Config Server

## Installation

```
npm install cloud-foundry-config-client
```

or

```
yarn add cloud-foundry-config-client
```

## Usage

`cloud-foundry-config-client` exposes a method used to load the configuration on start of the application and a static property for reading the currently loaded configuration object.

The first step is to `load` the configuration from a Cloud Foundry Config Server (or optionally from a local yaml file):

```javascript
// index.js
import * as express from 'express';
import { Config } from 'cloud-foundry-config-client';
...
Config.load({
  // defines the application name to used when querying the config server
  appName: "myExpressApp",
  // "remote" will query the config server, "remoteSkipAuth" will query the config server skipping authorization step and "local" will read from a local yaml file
  configLocation: "remote",
  // profile to use when querying the config server, e.g "dev", "uat", "prod"
  profile: "dev",
  // the name of the config server in PCF
  configServerName: "myConfigServer",
  // optional property to control logging of loaded config to console
  logProperties: true | false | undefined,
  // optional property to control auto-refresh of config based on given interval (seconds)
  interval: number | undefined
})
.then(() => { // on successful load, start your application
  const app = express()
  app.get('/', function (req, res) {
    res.send('Hello World')
  })
  app.listen(3000)
})
.catch(err => {
  console.log(err);
});
```

Once the configuration has been loaded, it can be accessed in any other module buy referencing the `current` property on the `Config` object:

```javascript
import * as jwt from 'express-jwt';
import { Config } from 'cloud-foundry-config-client';

...
// Get the JWT secret that was retrieved from config server
const { jwt_secret } = Config.current;

app.use(jwt({ secret: jwt_secret }));
app.use((err, req, res, next) => {
  if (err.name === "UnauthorizedError") {
    res.status(401).send("invalid token...");
  }
});

}
```

## Considerations

This is currently a very basic client and as such it enforces some limitations on the usage of the Spring Cloud Config Server.

- This client has only been tested with a git repo backing the config server
- The client expects configuration yaml files to be stored in the root of the git backing repo with the following file name convention: `{appName}-{profile}.yml //(e.g. myExpressApp-dev.yml)`

## Loading from a local file

If you haven't had a chance to configure a Cloud Foundry Cloud Config Server yet, you can fake it by loading configuration from a local yaml file:

```javascript
Config.load({
  appName: "myExpressApp",
  configLocation: "local", // gets configuration from local yaml file
  profile: "dev",
  configServerName: "myConfigServer"
})
...
```

When loading from a local file, cloud-foundry-config-client expects the file to have a particular path and filename based on the `{ appName, profile, configServerName }` passed into the load function. These parameters are used to build the path and filename based on the following convention:

```bash
// relative to the current working directory
./{configServerName}/{appName}-{profile}.yml
```

Which, in our example above, translates to:

```bash
./myConfigServer/myExpressApp-dev.yml
```

## Loading from a remote config server while running application locally

It is also possible to load configuration from a Cloud Foundry Config Server while running your application locally. `cloud-foundry-config-client` looks in the VCAP_SERVICES environment variable to find the client credentials needed to connect to a Config Server (based on `{ configServerName }` passed into the `load` function).

If you want to load your configuration from a remote Config Server while running locally, copy the relevant VCAP_SERVICES to your local machine and either set a VCAP_SERVICES environment variable before running your app, or, more easily, copy the JSON into a `vcap_services.json` file in the root of your application folder:

```json
// vcap_services.js
// cloud-foundry-config-client checks here if no
// VCAP_SERVICES environment variable is found

{
  "p-config-server": [
    {
      "credentials": {
        "uri": "local.config",
        "client_secret": "secret",
        "client_id": "id",
        "access_token_uri": "local.token"
      },
      "name": "test-config"
    }
  ]
}
```

Then, just start your application locally, specifying `{ configLocation = "remote" }` in your `load` function:

```javascript
Config.load({
  appName: "myExpressApp",
  configLocation: "remote",
  profile: "dev",
  configServerName: "myConfigServer"
})
...
```

## Loading from a remote config server while running application locally skipping the authorization step

If you are using a local Config Server for testing purposes and you don't want to manage with any kind of authorization, 
you can skip the authorization step following the next steps:

* Set the `configLocation` to `remoteSkipAuth`. 
* Set an environment variable with the Config Server URL: `CONFIG_SERVER_URI_WHEN_SKIP_AUTH="http://localhost:8888"`.
