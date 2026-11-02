import { prefs } from './db';

export type PhotoQuality = 'standard' | 'original';
export function photoQuality(): PhotoQuality { return prefs.get<PhotoQuality>('photoQuality', 'standard'); }
export function setPhotoQuality(q: PhotoQuality) { prefs.set('photoQuality', q); }

/**
 * Shrink a photo to at most 2560 px on the long side (about 0.5–1.5 MB) so a
 * summer of photos fits in Drive and uploads work on weak signal. "Original"
 * quality skips this and keeps the photo's location/date info.
 */
export async function preparePhoto(file: File, force?: PhotoQuality): Promise<Blob> {
  const q = force || photoQuality();
  if (q === 'original' || !file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('decode'));
      i.src = url;
    });
    const max = 2560;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) { URL.revokeObjectURL(url); return file; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.86));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file; // could not decode (e.g. HEIC on some Androids): upload as is
  }
}

export function photoName(file: File, blob: Blob): string {
  const base = (file.name || 'photo').replace(/\.[^.]+$/, '');
  if (blob === file) return file.name || base + extFor(file.type);
  return base + '.jpg';
}

export function extFor(mime: string): string {
  if (mime.includes('jpeg')) return '.jpg';
  if (mime.includes('png')) return '.png';
  if (mime.includes('heic')) return '.heic';
  if (mime.includes('quicktime')) return '.mov';
  if (mime.includes('mp4')) return mime.startsWith('audio') ? '.m4a' : '.mp4';
  if (mime.includes('webm')) return '.webm';
  if (mime.includes('ogg')) return '.ogg';
  if (mime.includes('mpeg')) return '.mp3';
  if (mime.includes('pdf')) return '.pdf';
  return '';
}

export function fmtSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function directionsUrl(dest: string, lat?: number | '', lon?: number | ''): string {
  const target = lat !== '' && lon !== '' && lat !== undefined && lon !== undefined ? `${lat},${lon}` : dest;
  if (isIOS()) return `https://maps.apple.com/?daddr=${encodeURIComponent(target)}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(target)}`;
}

export function telUrl(phone: string) { return 'tel:' + String(phone).replace(/[^\d+]/g, ''); }
export function smsUrl(phone: string) { return 'sms:' + String(phone).replace(/[^\d+]/g, ''); }

export function fmtPhone(phone: string): string {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return phone;
}

export function money(n: number | '' | undefined): string {
  if (n === '' || n === undefined || n === null || isNaN(Number(n))) return '';
  return Number(n).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

export function rwgpsEmbed(link: string): string | null {
  const m = link.match(/ridewithgps\.com\/(routes|trips)\/(\d+)/i);
  if (!m) return null;
  const type = m[1].toLowerCase() === 'trips' ? 'trip' : 'route';
  return `https://ridewithgps.com/embeds?type=${type}&id=${m[2]}&sampleGraph=true`;
}

/** Ask the phone to keep the screen on while recording an interview. */
export async function keepAwake(): Promise<() => void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } };
    if (!nav.wakeLock) return () => {};
    const lock = await nav.wakeLock.request('screen');
    return () => { void lock.release(); };
  } catch {
    return () => {};
  }
}
