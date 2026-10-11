// What an office employee enters, what the model may return, and what the validators report.
export interface IntakePhoto {
  id: string;
  file: string; // path under assets/source (the lab) or an uploaded asset
  staffCaption?: string | null;
  visibleDescription?: string | null; // filled by the vision step, low trust
}

export interface Intake {
  jobId: string;
  neighbourhoodSlug: string;
  roofType: string;
  serviceSlugs: string[];
  materialSlugs: string[];
  manufacturer?: string | null;
  colour?: string | null;
  squareFeet?: number | null;
  durationDays?: number | null;
  completedOn: string;
  existingConditions?: string | null;
  whatWasHard?: string | null;
  whatWeDid?: string | null;
  outcome?: string | null;
  staffNotes?: string | null; // UNTRUSTED free text, may contain anything
  photos: IntakePhoto[];
  // Never sent to the model. The validators check that none of it leaks into public text.
  private: { customerName: string; streetAddress: string; phone: string; email: string };
}

export interface Fact { id: string; label: string; value: string; kind: "entered" | "visual" | "derived" }

export type SectionKey = "existingConditions" | "challenges" | "solution" | "outcome";

export interface DraftSection { key: SectionKey; body: string; supportedBy: string[] }

export interface Draft {
  title: string;
  summary: string;
  sections: DraftSection[];
  seo: { title: string; description: string };
  photos: { photoId: string; alt: string; caption: string }[];
  relatedServiceSlugs: string[];
  relatedNeighbourhoodSlug: string;
  internalLinkSuggestions: { anchor: string; targetUrl: string; why: string }[];
  missingInformation: string[];
}

export interface Report { ok: boolean; errors: string[]; warnings: string[] }

export interface Context {
  neighbourhoods: { slug: string; name: string }[];
  services: { slug: string; name: string }[];
  materials: { slug: string; name: string }[];
  businessName: string;
  existingNarratives: { id: string; text: string }[];
  pageUrls: string[];
}

export type LlmFn = (req: { system: string; user: string; schema: object; model: string }) => Promise<unknown>;
