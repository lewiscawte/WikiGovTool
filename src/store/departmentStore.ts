import { Department } from '../types';
import { checkRoom, checkTextLength, MAX_ENTRIES_PER_STORE } from './limits';

// In-memory department overrides/extra departments (local-only, reset on restart).
// Allows adding/editing departments without writing to Wikidata.
const departmentOverrides = new Map<string, Partial<Department>>();
const extraDepartmentsByCountry = new Map<string, Department[]>();
let extraTotal = 0;

// Values just published to Wikidata, shown until its query service has them. They replace any
// local override of the same fields, and lapse after PUBLISHED_TTL_MS.
const PUBLISHED_TTL_MS = 24 * 60 * 60 * 1000;
const published = new Map<string, { patch: Partial<Department>; expiresAt: number }>();

export function getDepartmentOverride(qid: string): Partial<Department> | undefined {
  const local = departmentOverrides.get(qid);
  const recent = published.get(qid);
  if (recent && recent.expiresAt <= Date.now()) published.delete(qid);
  const fresh = recent && recent.expiresAt > Date.now() ? recent.patch : undefined;
  return local || fresh ? { ...local, ...fresh } : undefined;
}

export function setPublishedDepartment(qid: string, patch: Partial<Department>): void {
  const now = Date.now();
  for (const [key, entry] of published) if (entry.expiresAt <= now) published.delete(key);
  // Called after the edit is already on Wikidata, so a full store makes room rather than failing it.
  if (!published.has(qid) && published.size >= MAX_ENTRIES_PER_STORE) published.delete(published.keys().next().value as string);
  const local = departmentOverrides.get(qid);
  if (local) {
    const rest = { ...local };
    for (const key of Object.keys(patch) as (keyof Department)[]) delete rest[key];
    if (Object.keys(rest).length) departmentOverrides.set(qid, rest);
    else departmentOverrides.delete(qid);
  }
  published.set(qid, { patch: { ...published.get(qid)?.patch, ...patch }, expiresAt: now + PUBLISHED_TTL_MS });
}

export function setDepartmentOverride(qid: string, patch: Partial<Department>): void {
  checkTextLength({ label: patch.label, wikipediaTitle: patch.wikipediaTitle, inception: patch.inception, dissolved: patch.dissolved });
  if (!departmentOverrides.has(qid)) checkRoom(departmentOverrides.size, 'department edits');
  const existing = departmentOverrides.get(qid) || {};
  departmentOverrides.set(qid, { ...existing, ...patch });
}

export function addExtraDepartment(countryQid: string, dept: Department): void {
  checkTextLength({ label: dept.label, wikipediaTitle: dept.wikipediaTitle, inception: dept.inception, dissolved: dept.dissolved });
  checkRoom(extraTotal, 'departments');
  const list = extraDepartmentsByCountry.get(countryQid) ?? [];
  list.push(dept);
  extraDepartmentsByCountry.set(countryQid, list);
  extraTotal++;
}

export function listExtraDepartments(countryQid: string): Department[] {
  return extraDepartmentsByCountry.get(countryQid) ?? [];
}

export function clearDepartmentOverride(qid: string): void {
  departmentOverrides.delete(qid);
}
