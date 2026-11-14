export interface Account {
  id: string;
  name: string;
  accountId: string;
  hasS3: boolean;
  createdAt: string;
}
export interface Zone {
  id: string;
  name: string;
  status: string;
  name_servers?: string[];
  plan?: { name: string };
}
export interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied?: boolean;
  proxiable?: boolean;
  priority?: number;
  comment?: string;
  tags?: string[];
  data?: Record<string, unknown>;
}
export interface Bucket {
  name: string;
  creation_date?: string;
  location?: string;
  storage_class?: string;
}
export interface ObjectItem {
  key: string;
  size: number;
  lastModified?: string;
  etag?: string;
}
export interface ObjectPage {
  objects: ObjectItem[];
  folders: string[];
  cursor?: string;
}
export interface AuditEntry {
  id: number;
  action: string;
  accountName: string;
  resource: string;
  status: string;
  detail: string;
  createdAt: string;
}
export interface BucketDomain {
  domain: string;
  enabled: boolean;
  status?: { ownership: string; ssl: string };
  zoneId?: string;
}
