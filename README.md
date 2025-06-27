# `@fordi-org/reverse-proxy`

A simple reverse HTTP proxy, designed for easy, but flexible, configuration.

## Features

- Proxy incoming connections to any number of back-end servers
- Rewrite requests before proxying
- Hooks for pre- and post- request

## Usage

### Command-line

```bash
npx @fordi-org/reverse-proxy {configuration.js}
```

### Node

```bash
npm i @fordi-org/reverse-proxy
```

```javascript
import { createProxy } from '@fordi-org/reverse-proxy';

await createProxy({ /* ... configuration ... */ });
```

### Configuration

The configuration object has a schema as defined in [./config.d.ts](./config.d.ts).  If using a configuration file, the object must be that file's default export.
