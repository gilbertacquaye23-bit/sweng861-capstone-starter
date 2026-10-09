require("dotenv").config({ path: __dirname + "/.env" });

const axios = require("axios");
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const crypto = require("crypto");
const EventEmitter = require("events");
const { Issuer, generators } = require("openid-client");

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  UpdateCommand,
  PutCommand,
  ScanCommand,
  GetCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");

const {
  validateInsightInput,
  buildInsight,
} = require("./utils/insightUtils");

const {
  calculateAssessmentMetrics,
} = require("./utils/assessmentMetrics");

const {
  requestLogger,
  metricsHandler,
} = require("./observability");

const app = express();
const domainEvents = new EventEmitter();

const PORT = process.env.PORT || 3000;
const USERS_TABLE =
  process.env.DYNAMODB_USERS_TABLE || "SWENG861Users";
const INSIGHTS_TABLE =
  process.env.DYNAMODB_INSIGHTS_TABLE || "SWENG861FinancialInsights";
const TREASURY_TABLE =
  process.env.DYNAMODB_TREASURY_TABLE || "SWENG861TreasuryData";
const AWS_REGION = process.env.AWS_REGION || "us-east-2";
const {
  generateExecutiveInterpretation,
} = require("./utils/driftClient");

// --------------------------------------------------
// Logging
// --------------------------------------------------

function logEvent(level, event, requestId) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
  };

  if (requestId) {
    entry.requestId = requestId;
  }

  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

// --------------------------------------------------
// Middleware
// --------------------------------------------------

app.use(requestLogger);
app.get("/metrics", metricsHandler);
app.use(express.json());

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // Localhost development
    },
  })
);

// --------------------------------------------------
// DynamoDB
// --------------------------------------------------

const dynamoClient = new DynamoDBClient({
  region: AWS_REGION,
});

const dynamoDB = DynamoDBDocumentClient.from(dynamoClient);

// Automated tests mock this client's send() method.
app.locals.dynamoDB = dynamoDB;

logEvent("info", "users_table_configured");
logEvent("info", "insights_table_configured");
logEvent("info", "treasury_table_configured");
logEvent("info", "aws_region_configured");

// --------------------------------------------------
// Save authenticated user
// --------------------------------------------------

async function saveOrUpdateUser(userInfo) {
  const providerId = userInfo.sub;

  if (!providerId) {
    throw new Error(
      "Cognito did not return a stable provider identifier."
    );
  }

  const userId = providerId;
  const now = new Date().toISOString();
  const email = userInfo.email || "";

  const username =
    userInfo.preferred_username ||
    userInfo.username ||
    email ||
    "";

  const command = new UpdateCommand({
    TableName: USERS_TABLE,

    Key: {
      userId,
    },

    UpdateExpression: `
      SET
        providerId = :providerId,
        email = :email,
        username = :username,
        createdAt = if_not_exists(createdAt, :createdAt),
        updatedAt = :updatedAt,
        lastLoginAt = :lastLoginAt,
        #role = if_not_exists(#role, :defaultRole)
    `,

    ExpressionAttributeNames: {
      "#role": "role",
    },

    ExpressionAttributeValues: {
      ":providerId": providerId,
      ":email": email,
      ":username": username,
      ":createdAt": now,
      ":updatedAt": now,
      ":lastLoginAt": now,
      ":defaultRole": "Analyst",
    },

    ReturnValues: "ALL_NEW",
  });

  const result = await dynamoDB.send(command);

  logEvent("info", "user_record_saved");

  return result.Attributes;
}

// --------------------------------------------------
// Cognito / OpenID Connect
// --------------------------------------------------

let client;

async function initializeClient() {
  const issuerUrl =
    `https://cognito-idp.${AWS_REGION}.amazonaws.com/` +
    process.env.COGNITO_USER_POOL_ID;

  const issuer = await Issuer.discover(issuerUrl);

  client = new issuer.Client({
    client_id: process.env.COGNITO_CLIENT_ID,
    client_secret: process.env.COGNITO_CLIENT_SECRET,
    redirect_uris: [process.env.COGNITO_CALLBACK_URL],
    response_types: ["code"],
  });

  logEvent("info", "openid_client_initialized");
}

if (process.env.NODE_ENV !== "test") {
  initializeClient().catch(() => {
    logEvent("error", "openid_initialization_failed");
  });
}

// --------------------------------------------------
// Authentication middleware
// --------------------------------------------------

async function requireAuth(req, res, next) {
  // Test identities are disabled outside automated tests.
  if (
    process.env.NODE_ENV === "test" &&
    req.headers["x-test-user-id"]
  ) {
    req.user = {
      userId: req.headers["x-test-user-id"],
      email:
        req.headers["x-test-user-email"] || "test@example.com",
      username:
        req.headers["x-test-username"] || "test-user",
      role: req.headers["x-test-role"] || "Analyst",
    };

    return next();
  }

  let userInfo;

  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      if (!client) {
        return res.status(503).json({
          error: "ServiceUnavailable",
          message: "Authentication service is initializing",
        });
      }

      userInfo = await client.userinfo(authHeader.substring(7));
    } else {
      userInfo = req.session?.userInfo;
    }

    if (!userInfo?.sub) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Valid authentication is required",
      });
    }
  } catch (error) {
    logEvent(
      "error",
      "authentication_middleware_failed",
      req.requestId
    );

    return res.status(401).json({
      error: "Unauthorized",
      message: "Valid authentication is required",
    });
  }

  try {
    const result = await dynamoDB.send(
      new GetCommand({
        TableName: USERS_TABLE,
        Key: {
          userId: userInfo.sub,
        },
        ConsistentRead: true,
      })
    );

    const role = result.Item?.role;

    if (!["Analyst", "Director", "Executive"].includes(role)) {
      return res.status(403).json({
        error: "Forbidden",
        message: "Your account does not have a valid StratSight role",
      });
    }

    req.user = {
      userId: userInfo.sub,
      email: userInfo.email || null,
      username:
        userInfo.preferred_username ||
        userInfo.username ||
        userInfo.email ||
        null,
      role,
    };

    return next();
  } catch (error) {
    logEvent("error", "user_role_lookup_failed", req.requestId);

    console.error(
      "DynamoDB role lookup error:",
      error.name,
      error.message
    );

    return res.status(503).json({
      error: "ServiceUnavailable",
      message: "Unable to verify your account role",
    });
  }
}

// --------------------------------------------------
// Health and domain events
// --------------------------------------------------

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
  });
});

domainEvents.on("insight.created", () => {
  setImmediate(() => {
    logEvent("info", "insight_created_domain_event");
  });
});

// --------------------------------------------------
// Login
// --------------------------------------------------

app.get("/login", (req, res) => {
  if (!client) {
    return res
      .status(503)
      .send("Authentication service is still initializing.");
  }

  const nonce = generators.nonce();
  const state = generators.state();

  req.session.nonce = nonce;
  req.session.state = state;

  const authUrl = client.authorizationUrl({
    scope: "openid email",
    nonce,
    state,
  });

  return res.redirect(authUrl);
});

// --------------------------------------------------
// Home / Cognito callback
// --------------------------------------------------

app.get("/", async (req, res) => {
  if (!req.query.code) {
    if (req.session.userInfo) {
      return res.status(200).json({
        message: "User is authenticated",
        user: {
          email: req.session.userInfo.email,
        },
      });
    }

    return res.send(`
      <h1>StratSight</h1>
      <p>You are not logged in.</p>
      <p><a href="/login">Login with Amazon Cognito</a></p>
    `);
  }

  try {
    const params = client.callbackParams(req);

    const tokenSet = await client.callback(
      process.env.COGNITO_CALLBACK_URL,
      params,
      {
        nonce: req.session.nonce,
        state: req.session.state,
      }
    );

    const userInfo = await client.userinfo(tokenSet.access_token);

    logEvent("info", "login_succeeded", req.requestId);

    req.session.userInfo = userInfo;
    req.session.accessToken = tokenSet.access_token;
    req.session.idToken = tokenSet.id_token;

    try {
      await saveOrUpdateUser(userInfo);
    } catch (dbError) {
      logEvent("error", "user_persistence_failed", req.requestId);

      console.error(
        "DynamoDB user save error:",
        dbError.name,
        dbError.message
      );
    }

    return res.redirect("http://localhost:5173/initiatives");
  } catch (error) {
    logEvent(
      "error",
      "authentication_callback_failed",
      req.requestId
    );

    return res.status(500).send("Authentication failed");
  }
});

// --------------------------------------------------
// Logout and current user
// --------------------------------------------------

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    const logoutUrl =
      `${process.env.COGNITO_DOMAIN}/logout` +
      `?client_id=${process.env.COGNITO_CLIENT_ID}` +
      `&logout_uri=${encodeURIComponent(
        process.env.COGNITO_LOGOUT_URL
      )}`;

    res.redirect(logoutUrl);
  });
});

app.get("/api/me", requireAuth, (req, res) => {
  return res.status(200).json({
    user: {
      userId: req.user.userId,
      email: req.user.email,
      username: req.user.username,
      role: req.user.role,
    },
  });
});

app.get("/api/hello", requireAuth, (req, res) => {
  const email = req.user.email || "authenticated user";

  return res.status(200).json({
    message: `Hello, ${email}!`,
  });
});

// --------------------------------------------------
// Assessment input validation
// --------------------------------------------------

function normalizeAssessmentInputs(suppliedInputs) {
  if (
    !suppliedInputs ||
    typeof suppliedInputs !== "object" ||
    Array.isArray(suppliedInputs)
  ) {
    throw new Error("assessmentInputs must be an object");
  }

  const fields = [
    "currentVolume",
    "projectedVolume",
    "annualCapacity",
    "netRevenuePerCase",
    "variableCostPerCase",
    "additionalAnnualFixedCost",
    "initialInvestment",
  ];

  const inputs = Object.fromEntries(
    fields.map((field) => [field, suppliedInputs[field]])
  );

  const metrics = calculateAssessmentMetrics(inputs);

  return {
    inputs,
    metrics,
  };
}

// --------------------------------------------------
// Role and assessment access rules
// --------------------------------------------------

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: "Forbidden",
        message: "Your role does not permit this action",
      });
    }

    return next();
  };
}

const editable = (item) =>
  ["Draft", "Returned", "Open", "In Progress"].includes(item.status);

const canRead = (item, user) =>
  item.ownerId === user.userId ||
  (
    ["Director", "Executive"].includes(user.role) &&
    ["Submitted", "Returned", "Approved"].includes(item.status)
  );

// --------------------------------------------------
// History and persistence helpers
// --------------------------------------------------

function eventFor(req, action, status, comment = "") {
  return {
    action,
    status,
    comment,
    actorId: req.user.userId,
    actorEmail: req.user.email || "",
    actorRole: req.user.role,
    at: new Date().toISOString(),
  };
}

async function readAssessment(req) {
  const result = await dynamoDB.send(
    new GetCommand({
      TableName: INSIGHTS_TABLE,
      Key: {
        insightId: req.params.id,
      },
      ConsistentRead: true,
    })
  );

  return result.Item;
}

function failure(res, error) {
  if (error.name === "ConditionalCheckFailedException") {
    return res.status(409).json({
      error: "Conflict",
      message: "This assessment changed. Refresh and try again.",
    });
  }

  console.error(
    "Assessment operation failed:",
    error.name,
    error.message
  );

  return res.status(500).json({
    error: "InternalServerError",
    message: "Unable to save or retrieve assessment",
  });
}

// Conditional writes prevent overlapping operations
// from overwriting a status change.
async function saveAssessment(item, changes, event) {
  const next = {
    ...item,
    ...changes,
    updatedAt: new Date().toISOString(),
    history: [...(item.history || []), event],
  };

  const names = {
    "#status": "status",
  };

  const values = {
    ":owner": item.ownerId,
    ":status": item.status,
  };

  let condition =
    "attribute_exists(insightId) AND ownerId = :owner AND #status = :status";

  if (item.updatedAt !== undefined) {
    condition += " AND updatedAt = :previous";
    values[":previous"] = item.updatedAt;
  } else {
    condition += " AND attribute_not_exists(updatedAt)";
  }

  await dynamoDB.send(
    new PutCommand({
      TableName: INSIGHTS_TABLE,
      Item: next,
      ConditionExpression: condition,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  );

  return next;
}

// --------------------------------------------------
// Create assessment
// --------------------------------------------------

app.post(
  "/api/insights",
  requireAuth,
  requireRole("Analyst"),
  async (req, res) => {
    try {
      const validation = validateInsightInput(req.body || {});

      if (!validation.isValid) {
        return res.status(400).json({
          error: "BadRequest",
          message: validation.message,
        });
      }

      const item = buildInsight(req.body, req.user.userId);

      // The server controls the initial workflow status.
      item.status = "Draft";

      if (req.body.assessmentInputs !== undefined) {
        try {
          const normalized = normalizeAssessmentInputs(
            req.body.assessmentInputs
          );

          item.assessmentInputs = normalized.inputs;
          item.metrics = normalized.metrics;
        } catch (error) {
          return res.status(400).json({
            error: "BadRequest",
            message: error.message,
          });
        }
      }

      item.history = [
        eventFor(req, "Created", "Draft"),
      ];

      await dynamoDB.send(
        new PutCommand({
          TableName: INSIGHTS_TABLE,
          Item: item,
          ConditionExpression: "attribute_not_exists(insightId)",
        })
      );

      domainEvents.emit("insight.created", {
        insightId: item.insightId,
      });

      return res.status(201).json({
        data: item,
        message: "Financial insight created successfully",
      });
    } catch (error) {
      return failure(res, error);
    }
  }
);

// --------------------------------------------------
// List accessible assessments
// --------------------------------------------------

app.get("/api/insights", requireAuth, async (req, res) => {
  try {
    const items = [];
    let cursor;

    do {
      const result = await dynamoDB.send(
        new ScanCommand({
          TableName: INSIGHTS_TABLE,

          ...(req.user.role === "Analyst"
            ? {
                FilterExpression: "ownerId = :ownerId",
                ExpressionAttributeValues: {
                  ":ownerId": req.user.userId,
                },
              }
            : {}),

          ...(cursor
            ? {
                ExclusiveStartKey: cursor,
              }
            : {}),
        })
      );

      items.push(
        ...(result.Items || []).filter((item) =>
          canRead(item, req.user)
        )
      );

      cursor = result.LastEvaluatedKey;
    } while (cursor);

    items.sort((a, b) =>
      (b.updatedAt || "").localeCompare(a.updatedAt || "")
    );

    return res.json({
      data: items,
      count: items.length,
    });
  } catch (error) {
    return failure(res, error);
  }
});

// --------------------------------------------------
// Read one assessment
// --------------------------------------------------

app.get("/api/insights/:id", requireAuth, async (req, res) => {
  try {
    const item = await readAssessment(req);

    if (!item) {
      return res.status(404).json({
        error: "NotFound",
        message: "Financial insight not found",
      });
    }

    if (!canRead(item, req.user)) {
      return res.status(403).json({
        error: "Forbidden",
        message:
          "You are not authorized to access this financial insight",
      });
    }

    return res.json({
      data: item,
    });
  } catch (error) {
    return failure(res, error);
  }
});

// --------------------------------------------------
// Update draft or returned assessment
// --------------------------------------------------

app.put(
  "/api/insights/:id",
  requireAuth,
  requireRole("Analyst"),
  async (req, res) => {
    try {
      const item = await readAssessment(req);

      if (!item) {
        return res.status(404).json({
          error: "NotFound",
          message: "Assessment not found",
        });
      }

      if (item.ownerId !== req.user.userId) {
        return res.status(403).json({
          error: "Forbidden",
        });
      }

      if (!editable(item)) {
        return res.status(409).json({
          message:
            "Submitted or approved assessments cannot be edited",
        });
      }

      const { title, description, category } = req.body || {};

      if (
        [title, description, category].some(
          (value) =>
            typeof value !== "string" ||
            !value.trim()
        )
      ) {
        return res.status(400).json({
          message: "Title, description, and category are required",
        });
      }

      const changes = {
        title: title.trim(),
        description: description.trim(),
        category: category.trim(),
        status: item.status === "Returned" ? "Returned" : "Draft",
        executiveInterpretation: null,
      };

      try {
        const supplied =
          req.body.assessmentInputs ?? item.assessmentInputs;

        if (supplied !== undefined) {
          const normalized = normalizeAssessmentInputs(supplied);

          changes.assessmentInputs = normalized.inputs;
          changes.metrics = normalized.metrics;
        }
      } catch (error) {
        return res.status(400).json({
          message: error.message,
        });
      }

      const next = await saveAssessment(
        item,
        changes,
        eventFor(req, "Updated", changes.status)
      );

      return res.json({
        data: next,
        message: "Assessment updated",
      });
    } catch (error) {
      return failure(res, error);
    }
  }
);

// --------------------------------------------------
// Delete draft or returned assessment
// --------------------------------------------------

app.delete(
  "/api/insights/:id",
  requireAuth,
  requireRole("Analyst"),
  async (req, res) => {
    try {
      const item = await readAssessment(req);

      if (!item) {
        return res.status(404).json({
          error: "NotFound",
          message: "Assessment not found",
        });
      }

      if (item.ownerId !== req.user.userId) {
        return res.status(403).json({
          error: "Forbidden",
        });
      }

      if (!editable(item)) {
        return res.status(409).json({
          message:
            "Only draft or returned assessments can be deleted",
        });
      }

      await dynamoDB.send(
        new DeleteCommand({
          TableName: INSIGHTS_TABLE,

          Key: {
            insightId: req.params.id,
          },

          ConditionExpression:
            "ownerId = :owner AND #status = :status AND updatedAt = :previous",

          ExpressionAttributeNames: {
            "#status": "status",
          },

          ExpressionAttributeValues: {
            ":owner": req.user.userId,
            ":status": item.status,
            ":previous": item.updatedAt,
          },
        })
      );

      return res.json({
        message: "Assessment deleted",
      });
    } catch (error) {
      return failure(res, error);
    }
  }
);

// --------------------------------------------------
// Submit assessment for leadership review
// --------------------------------------------------

app.post(
  "/api/insights/:id/submit",
  requireAuth,
  requireRole("Analyst"),
  async (req, res) => {
    try {
      const item = await readAssessment(req);

      if (!item) {
        return res.status(404).json({
          error: "NotFound",
          message: "Assessment not found",
        });
      }

      if (item.ownerId !== req.user.userId) {
        return res.status(403).json({
          error: "Forbidden",
        });
      }

      if (!editable(item)) {
        return res.status(409).json({
          message:
            "Only draft or returned assessments can be submitted",
        });
      }

      let normalized;

      try {
        normalized = normalizeAssessmentInputs(
          item.assessmentInputs
        );
      } catch (error) {
        return res.status(400).json({
          message:
            "Complete all assessment inputs before submitting",
        });
      }

      const next = await saveAssessment(
        item,
        {
          status: "Submitted",
          metrics: normalized.metrics,
        },
        eventFor(req, "Submitted for review", "Submitted")
      );

      return res.json({
        data: next,
        message: "Assessment submitted",
      });
    } catch (error) {
      return failure(res, error);
    }
  }
);

// --------------------------------------------------
// Leadership review
// --------------------------------------------------

app.post(
  "/api/insights/:id/review",
  requireAuth,
  requireRole("Director", "Executive"),
  async (req, res) => {
    try {
      const item = await readAssessment(req);

      if (!item) {
        return res.status(404).json({
          error: "NotFound",
          message: "Assessment not found",
        });
      }

      if (item.ownerId === req.user.userId) {
        return res.status(403).json({
          message: "You cannot review your own assessment",
        });
      }

      if (item.status !== "Submitted") {
        return res.status(409).json({
          message: "Only submitted assessments can be reviewed",
        });
      }

      const { decision, comment } = req.body || {};

      if (
        !["Approved", "Returned"].includes(decision) ||
        typeof comment !== "string" ||
        !comment.trim() ||
        comment.length > 4000
      ) {
        return res.status(400).json({
          message:
            "Choose Approved or Returned and enter a comment (maximum 4000 characters)",
        });
      }

      const next = await saveAssessment(
        item,
        {
          status: decision,
        },
        eventFor(
          req,
          "Leadership review",
          decision,
          comment.trim()
        )
      );

      return res.json({
        data: next,
        message: "Review saved",
      });
    } catch (error) {
      return failure(res, error);
    }
  }
);

// --------------------------------------------------
// Generate and save DRIFT executive interpretation
// --------------------------------------------------

// Generate and save a DRIFT executive interpretation.
app.post(
  "/api/insights/:id/interpretation",
  requireAuth,
  requireRole("Analyst"),
  async (req, res) => {
    try {
      const item = await readAssessment(req);

      if (!item) {
        return res.status(404).json({
          error: "NotFound",
          message: "Assessment not found",
        });
      }

      if (item.ownerId !== req.user.userId) {
        return res.status(403).json({
          error: "Forbidden",
          message: "You cannot interpret another user's assessment",
        });
      }

      if (!editable(item)) {
        return res.status(409).json({
          message:
            "Generate an interpretation before submitting the assessment",
        });
      }

      let normalized;

      try {
        normalized = normalizeAssessmentInputs(
          item.assessmentInputs
        );
      } catch (error) {
        return res.status(400).json({
          message: "Complete all assessment inputs first",
        });
      }

      let text;

      try {
        text = await generateExecutiveInterpretation({
          ...item,
          assessmentInputs: normalized.inputs,
          metrics: normalized.metrics,
        });
      } catch (error) {
        const upstreamStatus = error.response?.status;

        console.error("DRIFT request error:", {
          status: error.response?.status,
          code: error.code,
          type: error.response?.data?.error?.type,
          message:
          error.response?.data?.error?.message ||
          error.message,
        });
        console.error("DRIFT request error:", {
          status: upstreamStatus,
          type: error.response?.data?.error?.type,
          code: error.response?.data?.error?.code,
          message: error.response?.data?.error?.message,
        });


        let message = "Unable to reach DRIFT. Please try again.";

        if (error.code === "DRIFT_NOT_CONFIGURED") {
          message = "DRIFT is not configured on the server";
        } else if (upstreamStatus === 401) {
          message = "DRIFT did not accept the configured API key";
        } else if (upstreamStatus === 403) {
          message = "DRIFT denied access to the configured model";
        } else if (upstreamStatus === 429) {
          message = "DRIFT usage limit reached. Try again later";
        } else if (upstreamStatus === 400 || upstreamStatus === 404) {
          message =
            "DRIFT rejected the request. Check the configured model";
        } else if (error.code === "DRIFT_INVALID_RESPONSE") {
          message = "DRIFT returned an empty or incomplete response";
        }

        // Log only safe metadata, never the key or Axios request.
        logEvent(
          "error",
          "DRIFT_interpretation_failed",
          req.requestId
        );

        return res
          .status(upstreamStatus === 429 ? 429 : 502)
          .json({
            error: "DRIFTServiceError",
            message,
          });
      }

      const next = await saveAssessment(
        item,
        {
          metrics: normalized.metrics,
          executiveInterpretation: {
            text,
            source: "DRIFT",
            generatedAt: new Date().toISOString(),
          },
        },
        eventFor(
          req,
          "Executive interpretation generated",
          item.status
        )
      );

      return res.json({
        data: next,
        message: "Executive interpretation generated",
      });
    } catch (error) {
      return failure(res, error);
    }
  }
);
// --------------------------------------------------
// Existing Treasury integration
// --------------------------------------------------

app.get(
  "/api/external/treasury-debt",
  requireAuth,
  async (req, res) => {
    try {
      const response = await axios.get(
        "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny"
      );

      const records =
        response.data && Array.isArray(response.data.data)
          ? response.data.data
          : null;

      if (!records || records.length === 0) {
        return res.status(502).json({
          error: "BadGateway",
          message: "Treasury API did not return valid debt data",
        });
      }

      const latestRecord = records[0];

      if (
        !latestRecord.record_date ||
        !latestRecord.tot_pub_debt_out_amt
      ) {
        return res.status(502).json({
          error: "BadGateway",
          message: "Treasury API response is missing required fields",
        });
      }

      const validatedData = {
        source: "U.S. Treasury Fiscal Data",
        recordDate: latestRecord.record_date,
        totalPublicDebt: latestRecord.tot_pub_debt_out_amt,
        debtHeldPublic:
          latestRecord.debt_held_public_amt || null,
        intragovHoldings:
          latestRecord.intragov_hold_amt || null,
      };

      const externalDataRecord = {
        externalDataId: crypto.randomUUID(),
        ownerId: req.user.userId,
        ...validatedData,
        importedAt: new Date().toISOString(),
      };

      const saveCommand = new PutCommand({
        TableName: TREASURY_TABLE,
        Item: externalDataRecord,
        ConditionExpression:
          "attribute_not_exists(externalDataId)",
      });

      await dynamoDB.send(saveCommand);

      logEvent("info", "treasury_data_saved", req.requestId);

      return res.status(200).json({
        message:
          "Treasury data retrieved, validated, and saved successfully",
        data: externalDataRecord,
      });
    } catch (error) {
      logEvent("error", "treasury_import_failed", req.requestId);

      return res.status(500).json({
        error: "InternalServerError",
        message: "Unable to retrieve or save Treasury data",
      });
    }
  }
);

// --------------------------------------------------
// Start server only when run directly
// --------------------------------------------------

if (require.main === module) {
  app.listen(PORT, () => {
    logEvent("info", "server_started");
  });
}

module.exports = app;