const request = require("supertest");
const app = require("../app");

describe("Authenticated financial-insight API tests", () => {
  const sendMock = jest.spyOn(
    app.locals.dynamoDB,
    "send"
  );

  beforeEach(() => {
    sendMock.mockReset();
  });

  afterAll(() => {
    sendMock.mockRestore();
  });

  test("authenticated user can create a valid insight", async () => {
    // Arrange
    sendMock.mockResolvedValue({});

    const input = {
      title: "Monthly Financial Review",
      description: "Review monthly performance",
      category: "Financial",
      status: "Open",
    };

    // Act
    const response = await request(app)
      .post("/api/insights")
      .set("x-test-user-id", "user-a")
      .set("x-test-user-email", "user-a@example.com")
      .send(input);

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.message).toBe(
      "Financial insight created successfully"
    );
    expect(response.body.data.ownerId).toBe("user-a");
    expect(response.body.data.title).toBe(
      "Monthly Financial Review"
    );
    expect(response.body.data.insightId).toEqual(
      expect.any(String)
    );
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  test("invalid insight data returns 400 without calling DynamoDB", async () => {
    const response = await request(app)
      .post("/api/insights")
      .set("x-test-user-id", "user-a")
      .send({
        title: "   ",
        description: "Review monthly performance",
        category: "Financial",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("BadRequest");
    expect(sendMock).not.toHaveBeenCalled();
  });

  test("authenticated user can retrieve their insight list", async () => {
    sendMock.mockResolvedValue({
      Items: [
        {
          insightId: "insight-1",
          ownerId: "user-a",
          title: "Monthly Review",
        },
        {
          insightId: "insight-2",
          ownerId: "user-a",
          title: "Budget Review",
        },
      ],
    });

    const response = await request(app)
      .get("/api/insights")
      .set("x-test-user-id", "user-a");

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(2);
    expect(response.body.data).toHaveLength(2);

    const command = sendMock.mock.calls[0][0];

    expect(
      command.input.ExpressionAttributeValues[":ownerId"]
    ).toBe("user-a");
  });

  test("owner can retrieve their own insight and receives 200", async () => {
    sendMock.mockResolvedValue({
      Item: {
        insightId: "insight-123",
        ownerId: "user-a",
        title: "Monthly Review",
      },
    });

    const response = await request(app)
      .get("/api/insights/insight-123")
      .set("x-test-user-id", "user-a");

    expect(response.status).toBe(200);
    expect(response.body.data.insightId).toBe(
      "insight-123"
    );
    expect(response.body.data.ownerId).toBe("user-a");
  });

  test("user cannot retrieve another user's insight and receives 403", async () => {
    sendMock.mockResolvedValue({
      Item: {
        insightId: "insight-123",
        ownerId: "user-a",
        title: "Private Financial Insight",
      },
    });

    const response = await request(app)
      .get("/api/insights/insight-123")
      .set("x-test-user-id", "user-b");

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Forbidden");
    expect(response.body.message).toContain(
      "not authorized"
    );
  });

  test("missing insight returns 404", async () => {
    sendMock.mockResolvedValue({});

    const response = await request(app)
      .get("/api/insights/missing-insight")
      .set("x-test-user-id", "user-a");

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("NotFound");
  });
});
