export interface WorkRow {
  year: string;
  title: string;
  venue?: string;
  text?: string;
  publisher?: string;
  /** Path under public/, e.g. "images/works/foo.jpg" */
  image?: string;
  /** External URL shown as a clickable link on the node */
  link?: string;
  /** YouTube video ID (the XXXX in youtube.com/watch?v=XXXX) */
  youtube?: string;
  section?: string;
}

export interface WorkSection {
  name: string;
  columns: string[];
  rows: WorkRow[];
  nofill?: boolean;
}
