import {
  DepartmentDetails,
  DepartmentLink,
  DepartmentOfficeRow,
  DeputyPair,
  fetchDepartmentDetails,
  fetchDepartmentLinks,
  fetchDepartmentOffices,
  fetchDepartmentsOfClass,
  fetchDeputyPairs,
  fetchOfficeholderHistory,
  fetchPositionLifespans,
  PositionHistoryRow,
  PositionLifespan,
} from './wikidataClient';
import { buildEntry, existedOn, loadCabinetPositions } from './orgchart';
import { Department, DepartmentsView, OrgChartEntry, OrgChartPosition } from '../types';
import { getDepartmentOverride, listExtraDepartments } from '../store/departmentStore';

// Country-specific Wikidata classes whose instances are that government's departments. Optional:
// departments are also found through their head offices (see fetchDepartmentLinks), but only a
// class lists abolished departments whose head office is no longer in the cabinet list.
const DEPARTMENT_CLASSES: Record<string, string> = {
  Q30: 'Q910252', // United States federal executive department
  Q145: 'Q2500378', // department of the United Kingdom Government
};

const isLeader = (p: OrgChartPosition) => p.bucket === 'Head of State' || p.bucket === 'Head of Government';

export interface AssembleInput {
  date: Date;
  country: string;
  // Cabinet-level offices, in display order (the US seed list is in order of precedence).
  cabinet: OrgChartPosition[];
  links: DepartmentLink[];
  details: Map<string, DepartmentDetails>;
  offices: DepartmentOfficeRow[];
  lifespans: Map<string, PositionLifespan>;
  history: PositionHistoryRow[];
  deputyPairs: DeputyPair[];
}

export function assembleDepartments(input: AssembleInput): DepartmentsView {
  const { date, cabinet, links, details, offices, lifespans, history, deputyPairs } = input;

  const withLifespan = (p: OrgChartPosition): OrgChartPosition => {
    const span = p.wikidataQid ? lifespans.get(p.wikidataQid) : undefined;
    return { ...p, inception: span?.inception ?? p.inception, dissolved: span?.dissolved ?? p.dissolved };
  };
  const entryFor = (p: OrgChartPosition): OrgChartEntry | null => {
    const position = withLifespan(p);
    return existedOn(position, date) ? buildEntry(position, history, date) : null;
  };

  const cabinetByQid = new Map(cabinet.filter((p) => p.wikidataQid).map((p) => [p.wikidataQid as string, p]));
  const leaderQids = new Set(cabinet.filter(isLeader).map((p) => p.wikidataQid).filter(Boolean));

  // Leaders, with any leader that is another leader's P2098 deputy nested under them
  // (e.g. Vice President under President), as on the offices page.
  const leaderEntries = cabinet.filter(isLeader).map(entryFor).filter((e): e is OrgChartEntry => e !== null);
  const leaderByQid = new Map(leaderEntries.filter((e) => e.position.wikidataQid).map((e) => [e.position.wikidataQid as string, e]));
  const nestedLeaders = new Set<string>();
  for (const pair of deputyPairs) {
    const senior = leaderByQid.get(pair.seniorQid);
    const junior = leaderByQid.get(pair.juniorQid);
    if (senior && junior && senior !== junior) {
      senior.deputies.push(junior);
      nestedLeaders.add(pair.juniorQid);
    }
  }
  const leaders = leaderEntries.filter((e) => !e.position.wikidataQid || !nestedLeaders.has(e.position.wikidataQid));

  // Display order: departments follow the first cabinet office that heads them; departments
  // found only through their class come after, alphabetically.
  const cabinetRank = new Map(cabinet.map((p, i) => [p.wikidataQid, i]));
  const deptRank = new Map<string, number>();
  for (const link of links) {
    const rank = cabinetRank.get(link.positionQid) ?? Infinity;
    deptRank.set(link.departmentQid, Math.min(rank, deptRank.get(link.departmentQid) ?? Infinity));
  }

  const deputiesOf = new Map<string, Set<string>>();
  for (const pair of deputyPairs) {
    if (!deputiesOf.has(pair.seniorQid)) deputiesOf.set(pair.seniorQid, new Set());
    deputiesOf.get(pair.seniorQid)!.add(pair.juniorQid);
  }

  const departments: Department[] = [];
  const placedCabinetQids = new Set<string>();

  // Merge in extra departments (local)
  const extraDepts = listExtraDepartments(input.country);
  for (const extra of extraDepts) {
    if (!details.has(extra.qid)) {
      details.set(extra.qid, {
        qid: extra.qid,
        label: extra.label,
        wikipediaTitle: extra.wikipediaTitle,
        inception: extra.inception,
        dissolved: extra.dissolved,
      });
    }
  }

  for (const dept of details.values()) {
    // Apply overrides
    const override = getDepartmentOverride(dept.qid);
    const deptLabel = override?.label ?? dept.label;
    const deptWp = override?.wikipediaTitle !== undefined ? override.wikipediaTitle : dept.wikipediaTitle;
    const deptIncep = override?.inception !== undefined ? override.inception : dept.inception;
    const deptDiss = override?.dissolved !== undefined ? override.dissolved : dept.dissolved;

    const deptForCheck = { qid: dept.qid, inception: deptIncep, dissolved: deptDiss };
    if (!existedOn(deptForCheck as any, date)) continue;

    const positionFor = (qid: string, label: string): OrgChartPosition => {
      const fromCabinet = cabinetByQid.get(qid);
      if (fromCabinet) return { ...fromCabinet, department: deptLabel };
      return {
        id: qid,
        title: label,
        department: deptLabel,
        bucket: 'Minister',
        wikipediaTitle: null,
        wikidataQid: qid,
        dynamic: true,
        inception: null,
        dissolved: null,
      };
    };

    const headQids = new Map<string, string>();
    for (const link of links) {
      if (link.departmentQid !== dept.qid) continue;
      const p = cabinetByQid.get(link.positionQid);
      if (p) headQids.set(link.positionQid, p.title);
    }
    for (const row of offices) {
      if (row.departmentQid === dept.qid && row.role === 'head') headQids.set(row.positionQid, row.positionLabel);
    }
    for (const qid of leaderQids) headQids.delete(qid as string);

    const heads = [...headQids]
      .map(([qid, label]) => entryFor(positionFor(qid, label)))
      .filter((e): e is OrgChartEntry => e !== null);
    heads.forEach((e) => placedCabinetQids.add(e.position.wikidataQid as string));

    const deputyQids = new Set(heads.flatMap((h) => [...(deputiesOf.get(h.position.wikidataQid as string) ?? [])]));
    const memberEntries = offices
      .filter((row) => row.departmentQid === dept.qid && row.role === 'member' && !headQids.has(row.positionQid) && !leaderQids.has(row.positionQid))
      .map((row) => entryFor(positionFor(row.positionQid, row.positionLabel)))
      .filter((e): e is OrgChartEntry => e !== null)
      // Deputies of the head first, then alphabetical.
      .sort((a, b) => {
        const aDep = deputyQids.has(a.position.wikidataQid as string) ? 0 : 1;
        const bDep = deputyQids.has(b.position.wikidataQid as string) ? 0 : 1;
        return aDep - bDep || a.position.title.localeCompare(b.position.title);
      });
    memberEntries.forEach((e) => placedCabinetQids.add(e.position.wikidataQid as string));

    departments.push({
      qid: dept.qid,
      label: deptLabel,
      wikipediaTitle: deptWp,
      inception: deptIncep,
      dissolved: deptDiss,
      heads,
      offices: memberEntries.filter((e) => e.officeholder),
      vacant: memberEntries.filter((e) => !e.officeholder),
    });
  }

  departments.sort((a, b) => {
    const ra = deptRank.get(a.qid) ?? Infinity;
    const rb = deptRank.get(b.qid) ?? Infinity;
    if (ra !== rb) return ra - rb;
    return a.label.localeCompare(b.label);
  });

  // Cabinet offices that exist on this date but sit in no department we could list — usually
  // a missing P2389/P2388 statement on Wikidata, which is exactly what this tool should surface.
  const unassigned = cabinet
    .filter((p) => !isLeader(p) && !(p.wikidataQid && placedCabinetQids.has(p.wikidataQid)))
    .map(entryFor)
    .filter((e): e is OrgChartEntry => e !== null);

  return { date: date.toISOString().slice(0, 10), country: input.country, leaders, departments, unassigned };
}

// A cabinet secretary's P2389 often lists more than their department — committees they chair
// (Treasury → Committee on Foreign Investment) or their own private office. Where an office
// links to at least one known department-class item, drop its other links.
export function preferClassDepartments(links: DepartmentLink[], classDepartments: Set<string>): DepartmentLink[] {
  if (classDepartments.size === 0) return links;
  const hasClassLink = new Set(links.filter((l) => classDepartments.has(l.departmentQid)).map((l) => l.positionQid));
  return links.filter((l) => !hasClassLink.has(l.positionQid) || classDepartments.has(l.departmentQid));
}

export async function buildDepartmentsView(date: Date, countryQid: string): Promise<DepartmentsView> {
  const cabinet = await loadCabinetPositions(countryQid);
  const cabinetQids = cabinet.map((p) => p.wikidataQid).filter((q): q is string => !!q);

  const classQid = DEPARTMENT_CLASSES[countryQid];
  const [allLinks, classDepartments] = await Promise.all([
    fetchDepartmentLinks(cabinetQids),
    classQid ? fetchDepartmentsOfClass(classQid) : Promise.resolve([]),
  ]);
  const links = preferClassDepartments(allLinks, new Set(classDepartments));
  // Leaders' P2389 targets (e.g. a prime minister's office) aren't listed as departments of
  // their own unless the country's department class includes them.
  const leaderQids = new Set(cabinet.filter(isLeader).map((p) => p.wikidataQid));
  const linkedDepartments = links.filter((l) => !leaderQids.has(l.positionQid)).map((l) => l.departmentQid);
  const departmentQids = [...new Set([...linkedDepartments, ...classDepartments])];

  const [details, offices] = await Promise.all([
    fetchDepartmentDetails(departmentQids),
    fetchDepartmentOffices(departmentQids),
  ]);

  const officeQids = [...new Set([...cabinetQids, ...offices.map((o) => o.positionQid)])];
  const [history, lifespans, deputyPairs] = await Promise.all([
    fetchOfficeholderHistory(officeQids),
    fetchPositionLifespans(officeQids),
    fetchDeputyPairs(officeQids),
  ]);

  return assembleDepartments({ date, country: countryQid, cabinet, links, details, offices, lifespans, history, deputyPairs });
}
