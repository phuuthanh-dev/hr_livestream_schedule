import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { google } from "googleapis";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function loadEnvFile(filePath, target = process.env) {
  if (!fs.existsSync(filePath)) return target;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (!key || target[key] != null) continue;
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    target[key] = value.replace(/\\n/g, "\n");
  }
  return target;
}

loadEnvFile(path.join(repoRoot, ".env"));

function readRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function createGoogleJwt(scopes) {
  return new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL?.trim() || readRequiredEnv("GOOGLE_SHEETS_CLIENT_EMAIL"),
    key: (process.env.GOOGLE_PRIVATE_KEY?.trim() || readRequiredEnv("GOOGLE_SHEETS_PRIVATE_KEY")).replace(/\\n/g, "\n"),
    scopes
  });
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function safeFileName(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, "_")
    .trim()
    .slice(0, 160);
}

function formatDateDisplay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleanText(value));
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatMoney(value) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(Number(value) || 0));
}

const DIGITS_VI = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];

function readTripleVi(value, full) {
  const hundred = Math.floor(value / 100);
  const ten = Math.floor((value % 100) / 10);
  const unit = value % 10;
  const parts = [];

  if (hundred > 0 || full) parts.push(`${DIGITS_VI[hundred]} trăm`);

  if (ten > 1) {
    parts.push(`${DIGITS_VI[ten]} mươi`);
    if (unit === 1) parts.push("mốt");
    else if (unit === 5) parts.push("lăm");
    else if (unit > 0) parts.push(DIGITS_VI[unit]);
    return parts.join(" ").trim();
  }

  if (ten === 1) {
    parts.push("mười");
    if (unit === 5) parts.push("lăm");
    else if (unit > 0) parts.push(DIGITS_VI[unit]);
    return parts.join(" ").trim();
  }

  if (unit > 0) {
    if (hundred > 0 || full) parts.push("lẻ");
    parts.push(DIGITS_VI[unit]);
  }

  return parts.join(" ").trim();
}

function numberToVietnameseWords(value) {
  const amount = Math.floor(Number(value) || 0);
  if (amount <= 0) return "Không đồng";
  const units = ["", "nghìn", "triệu", "tỷ"];
  const chunks = [];
  let remaining = amount;
  let unitIndex = 0;

  while (remaining > 0) {
    const chunk = remaining % 1000;
    if (chunk > 0) {
      const label = readTripleVi(chunk, unitIndex > 0 && chunks.length > 0);
      chunks.unshift([label, units[unitIndex]].filter(Boolean).join(" ").trim());
    }
    remaining = Math.floor(remaining / 1000);
    unitIndex += 1;
  }

  const sentence = chunks.join(" ").replace(/\s+/g, " ").trim();
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} đồng chẵn.`;
}

function normalizeRoleLabel(role) {
  return role === "support" ? "Support Livestream" : "Host Livestream";
}

async function main() {
  const [, , employeeIdArg, roleArg, fromDateArg, toDateArg, templateDocIdArg] = process.argv;
  const employeeId = cleanText(employeeIdArg).toUpperCase();
  const role = cleanText(roleArg).toLowerCase() || "host";
  const fromDate = cleanText(fromDateArg);
  const toDate = cleanText(toDateArg);
  const templateDocId = cleanText(templateDocIdArg);

  if (!employeeId || !fromDate || !toDate || !templateDocId) {
    throw new Error("Usage: node scripts/generate-payslip-doc.mjs <EMPLOYEE_ID> <ROLE> <FROM_DATE> <TO_DATE> <TEMPLATE_DOC_ID>");
  }

  const mongoUri = readRequiredEnv("MONGODB_URI");
  const mongoDbName = process.env.MONGODB_DB?.trim() || "hr_streaming";
  const mongo = new MongoClient(mongoUri);
  await mongo.connect();

  try {
    const db = mongo.db(mongoDbName);
    const entries = await db.collection("payroll_entries")
      .find({
        employeeId,
        role,
        dateKey: { $gte: fromDate, $lte: toDate }
      })
      .project({
        _id: 0,
        dateKey: 1,
        role: 1,
        employeeId: 1,
        employeeName: 1,
        scheduledHours: 1,
        basePay: 1,
        commissionPay: 1,
        deductions: 1,
        taxAmount: 1,
        grossPay: 1,
        netPay: 1,
        sessionIds: 1
      })
      .sort({ dateKey: 1, employeeName: 1 })
      .toArray();

    if (!entries.length) {
      throw new Error(`No payroll entries found for ${role}:${employeeId} in ${fromDate}..${toDate}.`);
    }

    const personKey = `${role}:${employeeId.toLowerCase()}`;
    const [contract, recruitment, roster] = await Promise.all([
      db.collection("employee_contract_profiles").findOne(
        { personKey },
        {
          projection: {
            _id: 0,
            employeeName: 1,
            contractCode: 1,
            bankAccountNumber: 1,
            bankName: 1,
            driveSync: 1
          }
        }
      ),
      db.collection("recruitment_profiles").findOne(
        { personKey },
        {
          projection: {
            _id: 0,
            fullName: 1,
            salaryOffered: 1
          }
        }
      ),
      db.collection("employees").findOne(
        { normalizedId: employeeId.toLowerCase() },
        {
          projection: {
            _id: 0,
            id: 1,
            name: 1,
            role: 1
          }
        }
      )
    ]);

    const employeeName = cleanText(recruitment?.fullName)
      || cleanText(contract?.employeeName)
      || cleanText(entries[0]?.employeeName)
      || cleanText(roster?.name)
      || employeeId;

    const totalHours = entries.reduce((sum, entry) => sum + (Number(entry.scheduledHours) || 0), 0);
    const basePay = entries.reduce((sum, entry) => sum + (Number(entry.basePay) || 0), 0);
    const commissionPay = entries.reduce((sum, entry) => sum + (Number(entry.commissionPay) || 0), 0);
    const taxAmount = entries.reduce((sum, entry) => sum + (Number(entry.taxAmount) || 0), 0);
    const grossTotal = entries.reduce((sum, entry) => sum + (Number(entry.grossPay) || 0), 0);
    const netPay = entries.reduce((sum, entry) => sum + (Number(entry.netPay) || 0), 0);
    const sessionCount = entries.reduce((sum, entry) => sum + (Array.isArray(entry.sessionIds) ? entry.sessionIds.length : 0), 0);
    const hourlyRate = totalHours > 0 ? Math.round(basePay / totalHours) : 0;
    const allowance = 0;
    const kpiReward = 0;
    const penalty = 0;
    const deductionsTotal = taxAmount + penalty;

    const auth = createGoogleJwt([
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/drive"
    ]);
    const drive = google.drive({ version: "v3", auth });
    const docs = google.docs({ version: "v1", auth });

    const folderId = cleanText(contract?.driveSync?.folderId);
    if (!folderId) throw new Error(`Missing Drive folder for ${personKey}.`);

    const fileName = safeFileName(`PHIEU_LUONG_${employeeId}_${fromDate}_${toDate}_${employeeName}`);
    const existing = await drive.files.list({
      q: [
        `'${folderId}' in parents`,
        `name='${fileName.replace(/'/g, "\\'")}'`,
        "trashed=false"
      ].join(" and "),
      fields: "files(id,name)",
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    const existingId = cleanText(existing.data.files?.[0]?.id);
    if (existingId) {
      try {
        await drive.files.delete({
          fileId: existingId,
          supportsAllDrives: true
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("File not found")) throw error;
      }
    }

    const copied = await drive.files.copy({
      fileId: templateDocId,
      requestBody: {
        name: fileName,
        parents: [folderId],
        appProperties: {
          employeeId,
          role,
          documentType: "payslip",
          periodFrom: fromDate,
          periodTo: toDate
        }
      },
      fields: "id,name,webViewLink",
      supportsAllDrives: true
    });

    const documentId = cleanText(copied.data.id);

    if (!documentId) throw new Error("Failed to create payslip document.");

    const requests = [
      ["Nguyễn Văn A", employeeName],
      ["Đội ngũ Livestream", "Đội ngũ Livestream"],
      ["Host Live chính", normalizeRoleLabel(role)],
      ["Ghi mã phiên live nhân sự đã live", `Từ ${formatDateDisplay(fromDate)} đến ${formatDateDisplay(toDate)} · ${sessionCount} ca live`],
      ["4.380.000", formatMoney(grossTotal)],
      ["30 giờ x 60.000đ", `${totalHours} giờ x ${formatMoney(hourlyRate)}đ`],
      ["1.800.000", formatMoney(basePay)],
      ["2% x 120.000.000đ", commissionPay > 0 ? cleanText(recruitment?.salaryOffered) || "Theo dữ liệu commission trong kỳ" : "Không phát sinh hoa hồng trong kỳ"],
      ["2.400.000", formatMoney(commissionPay)],
      ["Nếu có", allowance > 0 ? "Có phụ cấp" : "Không phát sinh"],
      ["180.000", formatMoney(allowance)],
      ["Thưởng đạt mốc mắt xem kỷ lục phiên 15/07", kpiReward > 0 ? "Thưởng KPI trong kỳ" : "Không phát sinh"],
      ["250.000", formatMoney(deductionsTotal)],
      ["Quên xác nhận ca ngày 13/07", penalty > 0 ? "Phạt vi phạm trong kỳ" : "Không phát sinh"],
      ["1 x 50.000đ", penalty > 0 ? `1 x ${formatMoney(penalty)}đ` : "-"],
      ["50.000", formatMoney(penalty)],
      ["438.000", formatMoney(taxAmount)],
      ["3.692.000", formatMoney(netPay)],
      ["Bốn triệu một trăm ba mươi ngàn đồng chẵn.", numberToVietnameseWords(netPay)],
      ["Techcombank (TCB)", cleanText(contract?.bankName) || "..."],
      ["190XXXXXXXXX", cleanText(contract?.bankAccountNumber) || "..."],
      ["NGUYEN VAN A", safeFileName(employeeName).replace(/_/g, " ").toUpperCase()],
      ["Mọi thắc mắc về sai lệch số liệu, vui lòng phản hồi lại bộ phận HR trước 17h00 ngày 28/07/2026.", "Mọi thắc mắc về sai lệch số liệu, vui lòng phản hồi lại bộ phận HR để được kiểm tra và đối soát."]
    ].map(([containsText, replaceText]) => ({
      replaceAllText: {
        containsText: { text: containsText, matchCase: true },
        replaceText
      }
    }));

    await docs.documents.batchUpdate({
      documentId,
      requestBody: { requests }
    });

    const documentUrl = `https://docs.google.com/document/d/${documentId}/edit`;
    console.log(JSON.stringify({
      ok: true,
      employeeId,
      role,
      employeeName,
      fromDate,
      toDate,
      sessionCount,
      totalHours,
      basePay,
      commissionPay,
      taxAmount,
      netPay,
      folderId,
      documentId,
      documentUrl,
      fileName
    }, null, 2));
  } finally {
    await mongo.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
