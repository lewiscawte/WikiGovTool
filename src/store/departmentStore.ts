import { Department } from '../types';
import { checkRoom, checkTextLength } from './limits';

// In-memory department overrides/extra departments (local-only, reset on restart).
// Allows adding/editing departments without writing to Wikidata.
const departmentOverrides = new Map<string, Partial<Department>>();
const extraDepartmentsByCountry = new Map<string, Department[]>();
let extraTotal = 0;

export function getDepartmentOverride(qid: string): Partial<Department> | undefined {
  return departmentOverrides.get(qid);
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
