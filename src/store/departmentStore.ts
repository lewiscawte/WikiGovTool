import { Department } from '../types';

// In-memory department overrides/extra departments (local-only, reset on restart).
// Allows adding/editing departments without writing to Wikidata.
const departmentOverrides = new Map<string, Partial<Department>>();
const extraDepartmentsByCountry = new Map<string, Department[]>();

export function getDepartmentOverride(qid: string): Partial<Department> | undefined {
  return departmentOverrides.get(qid);
}

export function setDepartmentOverride(qid: string, patch: Partial<Department>): void {
  const existing = departmentOverrides.get(qid) || {};
  departmentOverrides.set(qid, { ...existing, ...patch });
}

export function addExtraDepartment(countryQid: string, dept: Department): void {
  const list = extraDepartmentsByCountry.get(countryQid) ?? [];
  list.push(dept);
  extraDepartmentsByCountry.set(countryQid, list);
}

export function listExtraDepartments(countryQid: string): Department[] {
  return extraDepartmentsByCountry.get(countryQid) ?? [];
}

export function clearDepartmentOverride(qid: string): void {
  departmentOverrides.delete(qid);
}
