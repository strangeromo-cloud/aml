// Shared types for runtime vendor refresh endpoints.

export type NvidiaPart = {
  id: number;
  part_number: string;
  part_description: string;
  part_type: string | null;
  tpp: string | null;
  nv_hts: string | null;
  nveccn: string | null;
  state: string | null;
  mx_legacy_Material: string | null;
};

export type AmdPart = {
  part_number: string;
  us_eccn: string;
  us_hs: string;
  ccats: string;
  meets_3A090_a_1: string;
};

export type NvidiaMeta = {
  total: number;
  fetchedAt: string;
  sourcePage: string;
  apiUrl: string;
  distinctEccn: number;
  distinctHts: number;
  topEccn: { eccn: string; count: number }[];
  topHts: { hts: string; count: number }[];
  states: { state: string; count: number }[];
  partTypes: { type: string; count: number }[];
};

export type AmdMeta = {
  total: number;
  fetchedAt: string;
  classificationDate: string | null;
  sourcePage: string;
  pdfUrl: string;
  distinctEccn: number;
  distinctHs: number;
  distinctCcats: number;
  topEccn: { eccn: string; count: number }[];
  topHs: { hs: string; count: number }[];
  meets3A090: { meets: string; count: number }[];
};

export type FetchResult<TMeta> = {
  meta: TMeta;
  xlsxBuffer: Buffer;
};
