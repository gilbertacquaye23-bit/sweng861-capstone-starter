const {
  validateInsightInput,
  buildInsight,
} = require("../utils/insightUtils");

describe("validateInsightInput", () => {
  test("accepts valid required fields", () => {
    // Arrange
    const input = {
      title: "Monthly Financial Review",
      description: "Review financial performance",
      category: "Financial",
    };

    // Act
    const result = validateInsightInput(input);

    // Assert
    expect(result.isValid).toBe(true);
    expect(result.message).toBeNull();
  });

  test("accepts a valid optional status", () => {
    const input = {
      title: "Budget Analysis",
      description: "Analyze budget variances",
      category: "Budget",
      status: "In Progress",
    };

    const result = validateInsightInput(input);

    expect(result.isValid).toBe(true);
  });

  test("rejects a missing title", () => {
    const input = {
      description: "Review financial performance",
      category: "Financial",
    };

    const result = validateInsightInput(input);

    expect(result.isValid).toBe(false);
    expect(result.message).toContain("required");
  });

  test("rejects a description containing only spaces", () => {
    const input = {
      title: "Monthly Review",
      description: "   ",
      category: "Financial",
    };

    const result = validateInsightInput(input);

    expect(result.isValid).toBe(false);
  });

  test("rejects a missing category", () => {
    const input = {
      title: "Monthly Review",
      description: "Review financial performance",
    };

    const result = validateInsightInput(input);

    expect(result.isValid).toBe(false);
  });

  test("rejects a required field that is not a string", () => {
    const input = {
      title: 12345,
      description: "Review financial performance",
      category: "Financial",
    };

    const result = validateInsightInput(input);

    expect(result.isValid).toBe(false);
  });

  test("rejects an empty status when status is provided", () => {
    const input = {
      title: "Monthly Review",
      description: "Review financial performance",
      category: "Financial",
      status: "   ",
    };

    const result = validateInsightInput(input);

    expect(result.isValid).toBe(false);
    expect(result.message).toContain("status");
  });
});

describe("buildInsight", () => {
  const fixedOptions = {
    idFactory: () => "insight-123",
    nowFactory: () => "2026-09-24T12:00:00.000Z",
  };

  test("trims whitespace from insight fields", () => {
    const input = {
      title: "  Monthly Review  ",
      description: "  Review performance  ",
      category: "  Financial  ",
      status: "  Closed  ",
    };

    const result = buildInsight(
      input,
      "user-123",
      fixedOptions
    );

    expect(result.title).toBe("Monthly Review");
    expect(result.description).toBe("Review performance");
    expect(result.category).toBe("Financial");
    expect(result.status).toBe("Closed");
  });

  test("uses Open as the default status", () => {
    const input = {
      title: "Monthly Review",
      description: "Review performance",
      category: "Financial",
    };

    const result = buildInsight(
      input,
      "user-123",
      fixedOptions
    );

    expect(result.status).toBe("Open");
  });

  test("assigns the insight to the authenticated owner", () => {
    const input = {
      title: "Monthly Review",
      description: "Review performance",
      category: "Financial",
    };

    const result = buildInsight(
      input,
      "authenticated-user-456",
      fixedOptions
    );

    expect(result.ownerId).toBe(
      "authenticated-user-456"
    );
  });

  test("creates consistent ID and timestamp fields", () => {
    const input = {
      title: "Monthly Review",
      description: "Review performance",
      category: "Financial",
    };

    const result = buildInsight(
      input,
      "user-123",
      fixedOptions
    );

    expect(result.insightId).toBe("insight-123");
    expect(result.createdAt).toBe(
      "2026-09-24T12:00:00.000Z"
    );
    expect(result.updatedAt).toBe(
      "2026-09-24T12:00:00.000Z"
    );
  });
});
