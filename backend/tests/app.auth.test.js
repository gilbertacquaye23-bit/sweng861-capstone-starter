const request = require("supertest");
const app = require("../app");

describe("Backend health and authentication tests", () => {
  test("GET /health returns 200 and confirms the API is healthy", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
    });
  });

  test("GET /api/me returns 401 when the user is not logged in", async () => {
    const response = await request(app).get("/api/me");

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Unauthorized");
  });

  test("GET /api/hello returns 401 without authentication", async () => {
    const response = await request(app).get("/api/hello");

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Unauthorized");
  });

  test("GET /api/insights returns 401 without authentication", async () => {
    const response = await request(app).get("/api/insights");

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Unauthorized");
  });

  test("POST /api/insights returns 401 without authentication", async () => {
    const response = await request(app)
      .post("/api/insights")
      .send({
        title: "Monthly Financial Review",
        description: "Review monthly financial performance",
      });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Unauthorized");
  });
});
