const request = require("supertest");
const app = require("../app");
const inputs = { currentVolume: 1000, projectedVolume: 1200, annualCapacity: 1500,
  netRevenuePerCase: 500, variableCostPerCase: 300, additionalAnnualFixedCost: 10000, initialInvestment: 60000 };
const draft = { insightId: "assessment-1", ownerId: "analyst-1", title: "Expansion", description: "Sample", category: "Outpatient",
  status: "Draft", updatedAt: "2026-10-07T00:00:00.000Z", assessmentInputs: inputs };
let send;
beforeEach(() => { send = jest.spyOn(app.locals.dynamoDB, "send"); });
afterEach(() => { jest.restoreAllMocks(); });
const identity = (req, id = "analyst-1", role = "Analyst") => req.set("x-test-user-id", id).set("x-test-role", role);
test("analyst submits a complete draft with history and conditional write", async () => {
  send.mockResolvedValueOnce({ Item: draft }).mockResolvedValueOnce({});
  const res = await identity(request(app).post("/api/insights/assessment-1/submit"));
  expect(res.status).toBe(200); expect(res.body.data.status).toBe("Submitted");
  expect(res.body.data.metrics.incrementalAnnualContribution).toBe(30000);
  expect(res.body.data.history[0].actorRole).toBe("Analyst");
  expect(send.mock.calls[1][0].input.ConditionExpression).toContain("updatedAt = :previous");
});
test("director returns a submitted assessment with a comment", async () => {
  send.mockResolvedValueOnce({ Item: { ...draft, status: "Submitted" } }).mockResolvedValueOnce({});
  const res = await identity(request(app).post("/api/insights/assessment-1/review"), "director-1", "Director")
    .send({ decision: "Returned", comment: "Please revise the volume assumptions." });
  expect(res.status).toBe(200); expect(res.body.data.status).toBe("Returned");
  expect(res.body.data.history[0].comment).toContain("revise");
});
test("analyst cannot approve an assessment", async () => {
  const res = await identity(request(app).post("/api/insights/assessment-1/review")).send({ decision: "Approved", comment: "OK" });
  expect(res.status).toBe(403); expect(send).not.toHaveBeenCalled();
});
test("submitted assessments cannot be edited", async () => {
  send.mockResolvedValueOnce({ Item: { ...draft, status: "Submitted" } });
  const res = await identity(request(app).put("/api/insights/assessment-1")).send({ title: "Changed", description: "Sample", category: "Test", status: "Draft" });
  expect(res.status).toBe(409); expect(send).toHaveBeenCalledTimes(1);
});
test("another analyst cannot submit someone else's draft", async () => {
  send.mockResolvedValueOnce({ Item: draft });
  const res = await identity(request(app).post("/api/insights/assessment-1/submit"), "other-analyst");
  expect(res.status).toBe(403); expect(send).toHaveBeenCalledTimes(1);
});
test("a reviewer cannot approve their own assessment", async () => {
  send.mockResolvedValueOnce({ Item: { ...draft, status: "Submitted" } });
  const res = await identity(request(app).post("/api/insights/assessment-1/review"), "analyst-1", "Director")
    .send({ decision: "Approved", comment: "OK" });
  expect(res.status).toBe(403);
});
test("review requires a comment", async () => {
  send.mockResolvedValueOnce({ Item: { ...draft, status: "Submitted" } });
  const res = await identity(request(app).post("/api/insights/assessment-1/review"), "director-1", "Director")
    .send({ decision: "Approved", comment: " " });
  expect(res.status).toBe(400);
});
test("concurrent status changes return a conflict", async () => {
  send.mockResolvedValueOnce({ Item: draft }).mockRejectedValueOnce(Object.assign(new Error("Changed"), { name: "ConditionalCheckFailedException" }));
  const res = await identity(request(app).post("/api/insights/assessment-1/submit"));
  expect(res.status).toBe(409);
});
