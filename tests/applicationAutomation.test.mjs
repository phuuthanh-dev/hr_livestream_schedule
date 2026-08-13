import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAppsScriptApplicationPayload,
  buildEmployeeId,
  buildEmployeeMutationFromApplication,
  nextEmployeeIdForRole
} from "../lib/applicationAutomation.ts";

test("builds the next Host and Support employee ids from existing roster ids", () => {
  assert.equal(nextEmployeeIdForRole("host", ["HRLT01", "HRLT09", "HRLT24"]), "HRLT25");
  assert.equal(nextEmployeeIdForRole("support", ["HRSL01", "HRSL02_6H", "HRSL15"]), "HRSL16");
  assert.equal(nextEmployeeIdForRole("support", []), "HRSL01");
});

test("formats employee ids with zero padding", () => {
  assert.equal(buildEmployeeId("host", 3), "HRLT03");
  assert.equal(buildEmployeeId("support", 12), "HRSL12");
});

test("maps a Host application into an employee draft", () => {
  const mutation = buildEmployeeMutationFromApplication({
    role: "host",
    fullName: "Nguyen Minh Anh",
    phone: "0901 234 567",
    email: "minhanh@gmail.com",
    cvUrl: "https://drive.google.com/file/d/cv",
    experience: "2 nam livestream",
    achievements: "Top 3 doanh so",
    expectedSalary: "150.000/giờ",
    liveLocationPreference: "studio",
    liveAccountPreference: "personal",
    introVideoUrl: "https://youtu.be/demo",
    tiktokUrl: "https://tiktok.com/@demo",
    notes: "Có thể bắt đầu ngay"
  }, "HRLT25");

  assert.deepEqual(mutation, {
    id: "HRLT25",
    role: "host",
    name: "Nguyen Minh Anh",
    level: "Mới ứng tuyển",
    workLocation: "studio",
    phone: "0901234567",
    cvReference: "https://drive.google.com/file/d/cv",
    cashOffer: "150.000/giờ",
    castStatus: "Chờ thỏa thuận",
    experience: "2 nam livestream",
    trainingStatus: "Chưa training",
    notes: "Email: minhanh@gmail.com\nVideo: https://youtu.be/demo\nTikTok: https://tiktok.com/@demo\nGhi chú: Có thể bắt đầu ngay",
    achievements: "Top 3 doanh so",
    zaloStatus: "",
    liveAccountType: "Cá nhân",
    liveChannelId: ""
  });
});

test("maps a Support application into an employee draft", () => {
  const mutation = buildEmployeeMutationFromApplication({
    role: "support",
    fullName: "Tran Ha",
    phone: "+84 901 234 567",
    email: "tranha@gmail.com",
    cvUrl: "https://drive.google.com/file/d/support-cv",
    experience: "Biết OBS và ghim giỏ hàng",
    achievements: "",
    expectedSalary: "80.000/giờ",
    notes: "Đã từng support mỹ phẩm"
  }, "HRSL16");

  assert.deepEqual(mutation, {
    id: "HRSL16",
    role: "support",
    name: "Tran Ha",
    level: "Mới ứng tuyển",
    phone: "+84901234567",
    cvReference: "https://drive.google.com/file/d/support-cv",
    cashOffer: "80.000/giờ",
    castStatus: "Chờ thỏa thuận",
    experience: "Biết OBS và ghim giỏ hàng",
    trainingStatus: "Chưa training",
    notes: "Email: tranha@gmail.com\nGhi chú: Đã từng support mỹ phẩm"
  });
});

test("builds the Apps Script payload for a Host application", () => {
  const payload = buildAppsScriptApplicationPayload({
    applicationId: "app_123",
    submittedAt: "2026-08-13T08:00:00.000Z",
    employeeId: "HRLT25",
    role: "host",
    fullName: "Nguyen Minh Anh",
    phone: "0901234567",
    email: "minhanh@gmail.com",
    cvUrl: "https://drive.google.com/file/d/cv",
    experience: "2 nam livestream",
    achievements: "Top 3 doanh so",
    expectedSalary: "150.000/giờ",
    liveLocationPreference: "studio",
    liveAccountPreference: "personal",
    introVideoUrl: "https://youtu.be/demo",
    tiktokUrl: "https://tiktok.com/@demo",
    notes: "Có thể bắt đầu ngay"
  });

  assert.deepEqual(payload, {
    action: "submit_application",
    applicationId: "app_123",
    submittedAt: "2026-08-13T08:00:00.000Z",
    employeeId: "HRLT25",
    role: "host",
    fullName: "Nguyen Minh Anh",
    phone: "0901234567",
    email: "minhanh@gmail.com",
    cvUrl: "https://drive.google.com/file/d/cv",
    experience: "2 nam livestream",
    achievements: "Top 3 doanh so",
    expectedSalary: "150.000/giờ",
    liveLocationPreference: "studio",
    liveAccountPreference: "personal",
    introVideoUrl: "https://youtu.be/demo",
    tiktokUrl: "https://tiktok.com/@demo",
    notes: "Có thể bắt đầu ngay"
  });
});
