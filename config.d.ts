// Main configuration.  This is what you export or pass into `createProxy()`.
export type ReverseProxyConfig = {
  // Map of virtual hostnames to back-end servers
  vhosts: Record<GlobPattern, VHostConfig>;
  // Port for reverse proxy
  port: number;
  // What adapters to bind; defaults to `['0.0.0.0']`
  bind?: string[];
  // Be loud
  debug?: boolean;
  // Configuration for SSL.  If present, server will be https instead of http.
  ssl?: SslConfig;
  // Pre- and post- request filters
  filters?: FilterConfig;
};

// Simple globbing for domain names, e.g., "*.example.com" -> /^.*\.example\.com$/
export type GlobPattern = string;
// URLPattern based capturing for paths.  see https://developer.mozilla.org/en-US/docs/Web/API/URLPattern/pathname
export type PathPattern = string;

// Configuration for a virtual host
export type VHostConfig = {
  // Back-end server hostname
  host: string;
  // Port
  port: number;
  // Use HTTPS instead of HTTP
  secure?: boolean;
  // How to rewrite paths requested to this server
  rules?: Record<PathPattern, RuleConfig>
};

// Either a template string for building the rewritten path, or a function that
// handles modifying the request.
export type RuleConfig = PathPattern | ((req: AnnotatedRequest, res: Response) => (boolean | undefined));

// A request amended with the requested virtual host and whatever matches were hit in the current rule.
export type AnnotatedRequest = Request & {
  matches?: Record<string, string>;
  vhost: string;
};

// A file URL to fetch content from disk, or the content itself.
// For the URL variant, you'd normally use `new URL('./path-to/key.pem', import.meta.url)`
// For content, you might use something like `fs.readFileSync('/path/to/key.pem')`.
export type FileOrContent = URL | string | Buffer | Uint8Array | ArrayBuffer;

export type SslConfig = {
  // SSL key
  key: FileOrContent;
  // Server certificate
  cert: FileOrContent;
};

export type FilterConfig = {
  pre: () => void;
  post: () => void;
};
