import assert from "node:assert/strict";
import test from "node:test";
import {
  isEmployeeContractComplete,
  normalizeEmployeeContractInput,
  validateEmployeeContractImageInput
} from "../lib/employeeContractValidation.ts";

const validInput = {
  gmail: "  nhanvien@gmail.com ",
  dateOfBirth: "2000-02-29",
  citizenId: " 079200001234 ",
  citizenIdIssuedDate: "2021-03-10",
  citizenIdIssuedPlace: " Cục Cảnh sát QLHC về TTXH ",
  permanentAddress: " 12 Nguyễn Huệ, Quận 1 ",
  temporaryAddress: " 45 Lê Lợi, Quận 3 ",
  bankAccountNumber: " 0123456789 ",
  bankName: " Vietcombank ",
  socialInsuranceNumber: "should-not-be-stored"
};

test("normalizes the employee-provided contract fields and omits BHXH", () => {
  const result = normalizeEmployeeContractInput(validInput, new Date("2026-08-13T00:00:00.000Z"));

  assert.deepEqual(result, {
    gmail: "nhanvien@gmail.com",
    dateOfBirth: "2000-02-29",
    citizenId: "079200001234",
    citizenIdIssuedDate: "2021-03-10",
    citizenIdIssuedPlace: "Cục Cảnh sát QLHC về TTXH",
    permanentAddress: "12 Nguyễn Huệ, Quận 1",
    temporaryAddress: "45 Lê Lợi, Quận 3",
    bankAccountNumber: "0123456789",
    bankName: "Vietcombank"
  });
  assert.equal("socialInsuranceNumber" in result, false);
});

test("requires a Gmail address", () => {
  assert.throws(
    () => normalizeEmployeeContractInput({ ...validInput, gmail: "nhanvien@company.vn" }),
    /Gmail/
  );
});

test("requires a 12-digit CCCD", () => {
  assert.throws(
    () => normalizeEmployeeContractInput({ ...validInput, citizenId: "123456789" }),
    /CCCD/
  );
});

test("rejects impossible or future dates", () => {
  assert.throws(
    () => normalizeEmployeeContractInput({ ...validInput, dateOfBirth: "2001-02-29" }),
    /Ngày sinh/
  );
  assert.throws(
    () => normalizeEmployeeContractInput(
      { ...validInput, citizenIdIssuedDate: "2027-01-01" },
      new Date("2026-08-13T00:00:00.000Z")
    ),
    /Ngày cấp/
  );
});

test("accepts the current Vietnam date while the server is still on the previous UTC date", () => {
  assert.doesNotThrow(() => normalizeEmployeeContractInput(
    { ...validInput, citizenIdIssuedDate: "2026-08-13" },
    new Date("2026-08-12T18:00:00.000Z")
  ));
});

test("requires a numeric bank account number", () => {
  assert.throws(
    () => normalizeEmployeeContractInput({ ...validInput, bankAccountNumber: "ABC-123" }),
    /Số tài khoản/
  );
});

test("marks a contract complete only after both CCCD sides are uploaded", () => {
  assert.equal(isEmployeeContractComplete({ citizenIdFront: { publicId: "front" } }), false);
  assert.equal(isEmployeeContractComplete({
    citizenIdFront: { publicId: "front" },
    citizenIdBack: { publicId: "back" }
  }), true);
});

test("accepts supported CCCD images up to 10 MB", () => {
  assert.doesNotThrow(() => validateEmployeeContractImageInput({
    contentType: "image/jpeg",
    size: 10 * 1024 * 1024
  }));
});

test("rejects unsupported or oversized CCCD files", () => {
  assert.throws(
    () => validateEmployeeContractImageInput({ contentType: "application/pdf", size: 1000 }),
    /JPEG, PNG hoặc WebP/
  );
  assert.throws(
    () => validateEmployeeContractImageInput({ contentType: "image/png", size: 10 * 1024 * 1024 + 1 }),
    /10 MB/
  );
});
