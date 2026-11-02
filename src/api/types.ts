// Shared data model. Every type here maps 1:1 to a tab in the Google Sheet
// "master file" (see backend/Code.gs → SCHEMA). Column headers in the sheet are
// human friendly ("Planned Miles"); the API turns them into camelCase keys
// ("plannedMiles").

export type Role = 'rider' | 'leader' | 'routemaster';

export interface Rider {
  name: string;
  role: Role;
  phone: string;
  email: string;
  canDrive: boolean;
  notifyTopic?: string;
  emergencyContact?: string;
}

export interface Day {
  day: number;
  date: string; // yyyy-mm-dd
  from: string;
  to: string;
  plannedMiles: number | '';
  rwgpsLink: string;
  routeMiles: number | '';
  elevationGainFt: number | '';
  startLat: number | '';
  startLon: number | '';
  endLat: number | '';
  endLon: number | '';
  stayoverId: string;
  driver: string; // comma separated if more than one
  routeLeader: string;
  restDay: boolean;
  routeNotes: string;
  notesFromPreviousRiders: string;
}

export interface Stayover {
  id: string;
  name: string;
  address: string;
  city: string;
  lat: number | '';
  lon: number | '';
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  checkInTime: string;
  checkOutTime: string;
  dinner: string;
  breakfast: string;
  lunch: string;
  showers: string;
  laundry: string;
  sleeping: string;
  wifi: string;
  vanParking: string;
  notes: string;
  caller: string;
  confirmed: boolean;
  confirmedBy: string;
  confirmedAt: string;
  callNotes: string;
}

export interface Duty {
  id: string;
  day: number;
  person: string;
  duty: string;
  details: string;
  done: boolean;
  doneBy: string;
  doneAt: string;
}

export interface Config {
  teamName: string;
  tripYear: string;
  confirmDaysAhead: number;
  emergencyInfo: string;
  driveFolderUrl?: string; // leaders only
}

/** A form every rider hands in (Forms tab): waiver, insurance card, media release… */
export interface FormReq {
  id: string;
  form: string;
  description: string;
  required: boolean;
  templateLink: string;
  dueDate: string;
}

export interface Bootstrap {
  config: Config;
  me: Rider;
  riders: Rider[];
  itinerary: Day[];
  stayovers: Stayover[];
  duties: Duty[];
  forms: FormReq[];
  submissions: Submission[]; // mine
}

// ---- Things people add during the day -------------------------------------

interface RowBase {
  id: string;
  timestamp: string; // ISO
  day: number;
  _pending?: boolean; // waiting in the outbox, not yet on the server
}

export type CheckinType = 'Left stayover' | 'Arrived' | 'In the van' | 'Team checked in at stayover' | 'Team checked out of stayover' | 'Other';

export interface Checkin extends RowBase { rider: string; type: CheckinType; lat: number | ''; lon: number | ''; note: string; }
export interface Journal extends RowBase { author: string; visibility: 'shared' | 'private' | 'phone'; title: string; text: string; }

export type ReportCategory = 'Route issue' | 'Route comment' | 'Stayover comment' | 'Bike / mechanical' | 'Health / injury' | 'Van accident' | 'Other';
export interface Report extends RowBase {
  author: string; category: ReportCategory; severity: 'Low' | 'Medium' | 'High' | '';
  text: string; lat: number | ''; lon: number | ''; details: string; status: 'Open' | 'Resolved' | ''; resolvedBy: string;
}
export interface Gas extends RowBase {
  driver: string; gallons: number; pricePerGallon: number; total: number; odometer: number | '';
  station: string; paidWith: string; notes: string; receiptLink: string;
}
export interface Expense extends RowBase {
  recordedBy: string; amount: number; vendor: string; category: string; paidWith: string;
  reimburseTo: string; notes: string; receiptLink: string;
}
export interface Donation extends RowBase {
  recordedBy: string; donor: string; donorContact: string; type: string; amount: number | '';
  description: string; thankYouSent: boolean; notes: string; fileLink: string;
}
export interface Interview extends RowBase {
  interviewers: string; interviewee: string; location: string; contact: string;
  releaseSigned: boolean; summary: string; status: string; folderUrl: string;
}
export interface DriverSwap extends RowBase { fromDriver: string; toDriver: string; changedBy: string; reason: string; }

export type FormStatus = 'Submitted' | 'Approved' | 'Needs redo';
export interface Submission extends RowBase {
  rider: string; formId: string; form: string; status: FormStatus; note: string; fileLink: string; reviewedBy: string; reviewedAt: string;
}

export type MediaKind = 'photo' | 'video' | 'receipt' | 'donation' | 'interview-audio' | 'interview-video' | 'interview-photo' | 'release-form' | 'report' | 'rider-form';
export interface Media extends RowBase {
  uploader: string; kind: MediaKind; fileName: string; mimeType: string; size: number;
  driveFileId: string; driveUrl: string; caption: string; linkedSheet: string; linkedId: string;
  localUrl?: string; // object URL for files still on this phone
  progress?: number; // 0..1 while uploading
}

export interface SheetRows {
  Checkins: Checkin;
  Journals: Journal;
  Reports: Report;
  Gas: Gas;
  Expenses: Expense;
  Donations: Donation;
  Interviews: Interview;
  Media: Media;
  DriverSwaps: DriverSwap;
  Submissions: Submission;
}
export type ListSheet = keyof SheetRows;
export type AddSheet = Exclude<ListSheet, 'Media' | 'DriverSwaps'>;
