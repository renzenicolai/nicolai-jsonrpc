# Nicolai JSON RPC library

## Usage

### The RPC class

Creating an API is done by instantiating the RPC class with

Optional parameters:

- An identity: a string containing the name of the API
- A session manager object which implements a getSession(token) function which returns a session

A session may implement the following functions:

- setConnection(connection)
- checkPermission(method) -> bool : a function which returns a boolean indicating weither or not the requested method may be executed

### The webserver class

### The session manager class


### Nginx webserver as a reverse proxy

Add the following snippet to the `server` section of your Nginx configuration:

```
  location /api/ {
      # dont forget to strip /api from the front, since the backend doesnt expect that.
      rewrite ^/api/(.*)$ /$1 break;
      proxy_pass http://127.0.0.1:8000;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "Upgrade";
  }
```

This will forward all requests (both HTTP and Websockets) to the RPC server running in Node. Nginx will still serve all other paths on the server. It can also supply a secure HTTPS connection to the outside world, without making changes to your application.

If Nginx or another reverse proxy is used make sure to limit direct access to the API server to localhost, to prevent direct connections from the outside world.

```
var webserver = new Webserver({
    port: 8000,
    host: "127.0.0.1", // Only listen to localhost
    application: rpc
});
```

## Examples

### Basic usage of the RPC library

The example `rpc_only.js` demonstrates the basic usage of the RPC library.

### Using the included webserver

The example `webserver_simple.js` demonstrates using the RPC library in combination with the included webserver.

### Using the session manager

The example `webserver_sessionmanager.js`demonstrates using the RPC library in combination with the included webserver and the included session manager.

## License

MIT License

Copyright (c) 2021 Renze Nicolai

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
