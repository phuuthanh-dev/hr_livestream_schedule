import { redirect } from "next/navigation";
import ScheduleDashboard from "@/components/ScheduleDashboard";
import { getDashboardSession } from "@/lib/auth";
import { getScheduleWeekStartKey, isValidScheduleDateKey } from "@/lib/scheduleDate";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams: Promise<{ weekStartKey?: string }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const session = await getDashboardSession();
  if (!session) {
    return (
      <main className="marketingPage">
        <header className="marketingHeader">
          <div className="marketingBrand">
            <img alt="" src="/rr-logo-submark-square.png" />
            <span>
              <small>ROOT ROTATION</small>
              <strong>Livestream Operations Suite</strong>
            </span>
          </div>
          <nav className="marketingNav">
            <a href="#modules">Modules</a>
            <a href="#workflow">Workflow</a>
            <a href="#integration">Report Sync</a>
          </nav>
          <div className="marketingHeaderActions">
            <a className="marketingGhostButton" href="/apply">Apply</a>
            <a className="marketingPrimaryButton" href="/login">Admin Login</a>
          </div>
        </header>

        <section className="marketingHero">
          <div className="marketingHeroCopy">
            <span className="marketingEyebrow">COMPANY WEBSITE · INTERNAL SOFTWARE</span>
            <h1>Internal workforce software for livestream operations.</h1>
            <p>
              Root Rotation uses this application to manage candidate intake, employee records, support training,
              scheduling, contract completion, livestream report ingestion, and payroll calculation for livestream teams.
            </p>
            <div className="marketingHeroActions">
              <a className="marketingPrimaryButton" href="/login">Open System</a>
              <a className="marketingGhostButton" href="#workflow">See Workflow</a>
            </div>
          </div>
          <div className="marketingHeroPanel">
            <article>
              <span>Use case</span>
              <strong>Livestream HR & operations</strong>
              <small>Not an e-commerce storefront. This software is for internal team operations.</small>
            </article>
            <article>
              <span>Core output</span>
              <strong>Schedule + payroll</strong>
              <small>Confirmed work sessions are matched with livestream report records for payroll.</small>
            </article>
            <article>
              <span>Data flow</span>
              <strong>Staffing to payment</strong>
              <small>Application, training, assignment, report ingestion, and weekly payroll in one system.</small>
            </article>
          </div>
        </section>

        <section className="marketingSection" id="modules">
          <div className="marketingSectionHeading">
            <span className="marketingEyebrow">MODULES</span>
            <h2>What the software manages</h2>
          </div>
          <div className="marketingModuleGrid">
            <article><strong>Candidate Intake</strong><p>Applicants submit host or support profiles through the website. The system creates or updates employee records automatically.</p></article>
            <article><strong>Employee Records</strong><p>HR manages host and support personnel, contract data, operational status, and private identity documents.</p></article>
            <article><strong>Support Training</strong><p>Support live staff complete SOP-based training checklists that produce rating, level, and cash offer outcomes.</p></article>
            <article><strong>Scheduling</strong><p>Availability submissions, schedule generation, assignment visibility, and work-session confirmation are handled inside the app.</p></article>
            <article><strong>Livestream Report Ingestion</strong><p>Livestream report batches are ingested into the payroll workflow and normalized for matching against confirmed sessions.</p></article>
            <article><strong>Payroll Calculation</strong><p>The software calculates payroll from confirmed work sessions and livestream report data, while flagging mismatches and missing records.</p></article>
          </div>
        </section>

        <section className="marketingSection" id="workflow">
          <div className="marketingSectionHeading">
            <span className="marketingEyebrow">WORKFLOW</span>
            <h2>Operational flow inside the app</h2>
          </div>
          <div className="marketingFlow">
            <article><b>1</b><strong>Application</strong><p>Website intake creates structured employee records for host and support roles.</p></article>
            <article><b>2</b><strong>Training & contracts</strong><p>Support SOP checklist, contract completion, and employee metadata are stored in the same internal system.</p></article>
            <article><b>3</b><strong>Scheduling</strong><p>Teams submit availability and admins generate or review work schedules.</p></article>
            <article><b>4</b><strong>Livestream report sync</strong><p>Report data is ingested into the payroll pipeline for reconciliation with confirmed sessions.</p></article>
            <article><b>5</b><strong>Payroll</strong><p>The app calculates weekly payroll and highlights exceptions that require admin review.</p></article>
          </div>
        </section>

        <section className="marketingSection marketingIntegrationSection" id="integration">
          <div className="marketingSectionHeading">
            <span className="marketingEyebrow">REPORT SYNC</span>
            <h2>Livestream report ingestion is part of payroll operations</h2>
          </div>
          <div className="marketingIntegrationCard">
            <div>
              <strong>Livestream report connector</strong>
              <p>The payroll module receives livestream report batches, normalizes them, and matches them to confirmed work sessions before salary is calculated.</p>
            </div>
            <ul>
              <li>Input: livestream report batch</li>
              <li>Processing: session matching and exception detection</li>
              <li>Output: payroll entries, exception review, exportable weekly payroll</li>
            </ul>
          </div>
        </section>
      </main>
    );
  }

  const query = await searchParams;
  const initialWeekStartKey = query.weekStartKey && isValidScheduleDateKey(query.weekStartKey)
    ? getScheduleWeekStartKey(query.weekStartKey)
    : undefined;

  return (
    <ScheduleDashboard
      username={session.displayName}
      isAdmin={session.accountType === "admin"}
      employeeRole={session.role}
      employeeId={session.employeeId}
      initialWeekStartKey={initialWeekStartKey}
    />
  );
}
