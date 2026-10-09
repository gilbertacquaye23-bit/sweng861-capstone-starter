const crypto = require("crypto");

function validateInsightInput(input = {}) {
  const requiredFields = [
    "title",
    "description",
    "category",
  ];

  for (const field of requiredFields) {
    const value = input[field];

    if (
      typeof value !== "string" ||
      value.trim() === ""
    ) {
      return {
        isValid: false,
        message:
          "title, description, and category are required non-empty strings",
      };
    }
  }

  if (
    input.status !== undefined &&
    (
      typeof input.status !== "string" ||
      input.status.trim() === ""
    )
  ) {
    return {
      isValid: false,
      message:
        "status must be a non-empty string when provided",
    };
  }

  return {
    isValid: true,
    message: null,
  };
}

function buildInsight(
  input,
  ownerId,
  options = {}
) {
  const idFactory =
    options.idFactory || crypto.randomUUID;

  const nowFactory =
    options.nowFactory ||
    (() => new Date().toISOString());

  const now = nowFactory();

  return {
    insightId: idFactory(),
    ownerId,
    title: input.title.trim(),
    description: input.description.trim(),
    category: input.category.trim(),
    status: input.status
      ? input.status.trim()
      : "Open",
    createdAt: now,
    updatedAt: now,
  };
}

module.exports = {
  validateInsightInput,
  buildInsight,
};
