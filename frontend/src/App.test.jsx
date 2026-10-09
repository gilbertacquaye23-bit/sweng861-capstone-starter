import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import App from "./App";
import { apiRequest } from "./apiClient";

vi.mock("./apiClient", () => ({
  apiRequest: vi.fn(),
}));

const analyst = {
  userId: "user-a",
  email: "financial.leader@example.com",
  role: "Analyst",
};

const sampleInputs = {
  currentVolume: 1000,
  projectedVolume: 1200,
  annualCapacity: 1500,
  netRevenuePerCase: 500,
  variableCostPerCase: 300,
  additionalAnnualFixedCost: 10000,
  initialInvestment: 60000,
};

function assessment(overrides = {}) {
  return {
    insightId: "insight-123",
    ownerId: analyst.userId,
    title: "Bundled Payment Strategy",
    description: "Evaluate bundled payment performance",
    category: "Value-Based Care",
    status: "Draft",
    assessmentInputs: { ...sampleInputs },
    metrics: {
      incrementalVolume: 200,
      volumeGrowthPercent: 20,
      projectedCapacityUtilizationPercent: 80,
      capacityGap: 0,
      contributionPerCase: 200,
      incrementalAnnualContribution: 30000,
      simplePaybackYears: 2,
    },
    history: [],
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-10-09T12:00:00.000Z",
    ...overrides,
  };
}

function visit(path) {
  window.history.replaceState({}, "", path);
}

function mockLogin(user = analyst) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ user }),
    })
  );
}

async function fillCreateForm(user) {
  await user.type(await screen.findByLabelText("Title"), "Service Line Review");
  await user.type(screen.getByLabelText("Description"), "Review sample assumptions");
  await user.type(screen.getByLabelText("Service line / category"), "Cardiology");

  for (const [id, value] of Object.entries(sampleInputs)) {
    await user.type(document.getElementById(id), String(value));
  }
}

describe("StratSight assessment interface", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    visit("/initiatives");
    mockLogin();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test("displays an owned assessment and its calculated metrics", async () => {
    visit("/initiatives/insight-123");
    apiRequest.mockResolvedValue({ data: assessment() });

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Bundled Payment Strategy" })
    ).toBeInTheDocument();

    expect(
      screen.getByText("Evaluate bundled payment performance")
    ).toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: "Edit Assessment" })
    ).toHaveAttribute("href", "/initiatives/insight-123/edit");

    expect(screen.getByText("$30,000.00")).toBeInTheDocument();
    expect(screen.getByText("2 years")).toBeInTheDocument();
  });

  test("loads existing text and numeric values into the edit form", async () => {
    visit("/initiatives/insight-123/edit");
    apiRequest.mockResolvedValue({ data: assessment() });

    render(<App />);

    expect(await screen.findByLabelText("Title"))
      .toHaveValue("Bundled Payment Strategy");

    expect(screen.getByLabelText("Description"))
      .toHaveValue("Evaluate bundled payment performance");

    expect(screen.getByLabelText("Service line / category"))
      .toHaveValue("Value-Based Care");

    expect(screen.getByLabelText("Projected annual volume"))
      .toHaveValue(1200);

    expect(screen.getByText("Status: Draft")).toBeInTheDocument();
  });

  test("requires a title before saving an edit", async () => {
    visit("/initiatives/insight-123/edit");
    apiRequest.mockResolvedValue({ data: assessment() });

    const user = userEvent.setup();
    render(<App />);

    const title = await screen.findByLabelText("Title");
    await user.clear(title);
    await user.click(screen.getByRole("button", { name: "Save Assessment" }));

    // The current form uses native HTML required-field validation.
    expect(title).toBeInvalid();
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  test("shows an API error when an edit cannot be saved", async () => {
    visit("/initiatives/insight-123/edit");
    apiRequest
      .mockResolvedValueOnce({ data: assessment() })
      .mockRejectedValueOnce(new Error("Unable to update assessment"));

    const user = userEvent.setup();
    render(<App />);

    const title = await screen.findByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Updated Financial Review");
    await user.click(screen.getByRole("button", { name: "Save Assessment" }));

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Unable to update assessment");

    expect(apiRequest).toHaveBeenLastCalledWith(
      "/api/insights/insight-123",
      expect.objectContaining({ method: "PUT" })
    );

    const request = apiRequest.mock.calls.at(-1)[1];
    expect(JSON.parse(request.body)).toMatchObject({
      title: "Updated Financial Review",
      status: "Draft",
      assessmentInputs: sampleInputs,
    });
  });

  test("shows loading while assessments are being retrieved", async () => {
    apiRequest.mockReturnValue(new Promise(() => {}));

    render(<App />);

    expect(await screen.findByText("Loading assessments..."))
      .toBeInTheDocument();

    expect(
      screen.getByText("financial.leader@example.com · Analyst")
    ).toBeInTheDocument();
  });

  test("redirects an unauthenticated user to login", async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "Unauthorized" }),
    });

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Welcome to StratSight" })
    ).toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: "Login with Amazon Cognito" })
    ).toHaveAttribute("href", "http://localhost:3000/login");

    expect(window.location.pathname).toBe("/login");
    expect(apiRequest).not.toHaveBeenCalled();
  });

  test("displays assessments returned by the API", async () => {
    apiRequest.mockResolvedValue({ data: [assessment()] });

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Bundled Payment Strategy" })
    ).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "My Assessments" }))
      .toBeInTheDocument();

    expect(screen.getByRole("link", { name: "View Details" }))
      .toHaveAttribute("href", "/initiatives/insight-123");

    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  test("shows an empty state when no assessments exist", async () => {
    apiRequest.mockResolvedValue({ data: [] });

    render(<App />);

    expect(await screen.findByText("No assessments available yet."))
      .toBeInTheDocument();
  });

  test("shows an API error when assessments cannot be loaded", async () => {
    apiRequest.mockRejectedValue(new Error("Backend service unavailable"));

    render(<App />);

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Backend service unavailable");
  });

  test("requires a title on the create form", async () => {
    visit("/initiatives/new");

    const user = userEvent.setup();
    render(<App />);

    const title = await screen.findByLabelText("Title");
    await user.click(screen.getByRole("button", { name: "Save Assessment" }));

    expect(title).toBeRequired();
    expect(title).toBeInvalid();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  test("submits all seven numeric inputs and displays a create error", async () => {
    visit("/initiatives/new");
    apiRequest.mockRejectedValue(new Error("Unable to save assessment"));

    const user = userEvent.setup();
    render(<App />);

    await fillCreateForm(user);
    await user.click(screen.getByRole("button", { name: "Save Assessment" }));

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Unable to save assessment");

    expect(apiRequest).toHaveBeenCalledWith(
      "/api/insights",
      expect.objectContaining({ method: "POST" })
    );

    const request = apiRequest.mock.calls[0][1];
    expect(JSON.parse(request.body)).toEqual({
      title: "Service Line Review",
      description: "Review sample assumptions",
      category: "Cardiology",
      status: "Draft",
      assessmentInputs: sampleInputs,
    });
  });

  test("displays the API authorization error for a restricted assessment", async () => {
    visit("/initiatives/private-record");
    apiRequest.mockRejectedValue(new Error("Forbidden"));

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
    expect(screen.queryByRole("link", { name: "Edit Assessment" }))
      .not.toBeInTheDocument();
  });

  test("prevents an analyst from editing a submitted assessment", async () => {
    visit("/initiatives/insight-123/edit");
    apiRequest.mockResolvedValue({
      data: assessment({ status: "Submitted" }),
    });

    render(<App />);

    expect(await screen.findByText("This assessment cannot be edited."))
      .toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Save Assessment" }))
      .not.toBeInTheDocument();
  });

  test("requires a director comment and sends the return decision", async () => {
    mockLogin({
      userId: "director-b",
      email: "director@example.com",
      role: "Director",
    });
    visit("/initiatives/insight-123");

    apiRequest
      .mockResolvedValueOnce({
        data: assessment({ status: "Submitted" }),
      })
      .mockResolvedValueOnce({
        data: assessment({ status: "Returned" }),
      });

    const user = userEvent.setup();
    render(<App />);

    const comment = await screen.findByLabelText("Review comment");
    const returnButton = screen.getByRole("button", {
      name: "Return for Changes",
    });

    expect(returnButton).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Edit Assessment" }))
      .not.toBeInTheDocument();

    await user.type(comment, "Please validate the projected volume.");
    await user.click(returnButton);

    expect(apiRequest).toHaveBeenLastCalledWith(
      "/api/insights/insight-123/review",
      {
        method: "POST",
        body: JSON.stringify({
          decision: "Returned",
          comment: "Please validate the projected volume.",
        }),
      }
    );

    expect(await screen.findByText("Returned")).toBeInTheDocument();
  });

  test("generates and displays a DRIFT interpretation", async () => {
    visit("/initiatives/insight-123");
    apiRequest
      .mockResolvedValueOnce({ data: assessment() })
      .mockResolvedValueOnce({
        data: assessment({
          executiveInterpretation: {
            text: "Validate volume assumptions before making a decision.",
            source: "DRIFT",
            generatedAt: "2026-10-09T12:30:00.000Z",
          },
        }),
      });

    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: "Generate DRIFT Interpretation",
      })
    );

    expect(
      await screen.findByText(
        "Validate volume assumptions before making a decision."
      )
    ).toBeInTheDocument();

    expect(apiRequest).toHaveBeenLastCalledWith(
      "/api/insights/insight-123/interpretation",
      { method: "POST" }
    );

    expect(screen.getByText(/Generated by DRIFT/)).toBeInTheDocument();
  });

  test("validates missing numeric inputs before sending a request", async () => {
    visit("/initiatives/new");

    render(<App />);

    const title = await screen.findByLabelText("Title");

    // Submit directly to exercise the application's numeric validation,
    // independently of the browser's required-field validation.
    fireEvent.submit(title.closest("form"));

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Complete all seven numeric inputs.");

    expect(apiRequest).not.toHaveBeenCalled();
  });
});