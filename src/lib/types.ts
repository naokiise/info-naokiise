export interface WorkRow {
  year: string;
  title: string;
  href?: string;
  venue?: string;
  text?: string;
  publisher?: string;
}

export interface WorkSection {
  name: string;
  columns: string[];
  rows: WorkRow[];
}

export interface SiteData {
  sections: WorkSection[];
}
