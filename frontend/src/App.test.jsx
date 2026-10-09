import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import App from "./App";
import { apiRequest } from "./apiClient";

vi.mock("./apiClient", () => ({
  apiRequest: vi.fn(),
}));

describe("Healthcare Financial Strategy Dashboard", () => {
  beforeEach(() => {
    apiRequest.mockReset();

    window.history.pushState(
      {},
      "",
      "/initiatives"
    );

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        user: {
          email: "financial.leader@example.com",
        },
      }),
    });
  });

  test("displays the details of an owned initiative", async () => {
  window.history.pushState(
    {},
    "",
    "/initiatives/insight-123"
  );

  apiRequest.mockResolvedValue({
    data: {
      insightId: "insight-123",
      title: "Bundled Payment Strategy",
      description: "Evaluate bundled payment performance",
      category: "Value-Based Care",
      status: "In Progress",
      createdAt: "2026-09-01T12:00:00.000Z",
      updatedAt: "2026-09-20T12:00:00.000Z",
    },
  });

  render(<App />);

  expect(
    await screen.findByRole("heading", {
      name: "Bundled Payment Strategy",
    })
  ).toBeInTheDocument();

  expect(
    screen.getByText(
      "Evaluate bundled payment performance"
    )
  ).toBeInTheDocument();

  expect(
    screen.getByRole("link", {
      name: "Edit Initiative",
    })
  ).toHaveAttribute(
    "href",
    "/initiatives/insight-123/edit"
  );
});

test("loads existing values into the edit form", async () => {
  window.history.pushState(
    {},
    "",
    "/initiatives/insight-123/edit"
  );

  apiRequest.mockResolvedValue({
    data: {
      insightId: "insight-123",
      title: "Monthly Financial Review",
      description: "Review monthly performance",
      category: "Cost Management",
      status: "In Progress",
    },
  });

  render(<App />);

  expect(
    await screen.findByDisplayValue(
      "Monthly Financial Review"
    )
  ).toBeInTheDocument();

  expect(
    screen.getByDisplayValue(
      "Review monthly performance"
    )
  ).toBeInTheDocument();

  expect(
    screen.getByDisplayValue("Cost Management")
  ).toBeInTheDocument();

  expect(
    screen.getByDisplayValue("In Progress")
  ).toBeInTheDocument();
});

test("validates a blank title on the edit form", async () => {
  window.history.pushState(
    {},
    "",
    "/initiatives/insight-123/edit"
  );

  apiRequest.mockResolvedValue({
    data: {
      insightId: "insight-123",
      title: "Monthly Financial Review",
      description: "Review monthly performance",
      category: "Cost Management",
      status: "Open",
    },
  });

  const user = userEvent.setup();

  render(<App />);

  const titleInput =
    await screen.findByLabelText("Title");

  await user.clear(titleInput);

  await user.click(
    screen.getByRole("button", {
      name: "Save Changes",
    })
  );

  expect(
    screen.getByText("Title is required.")
  ).toBeInTheDocument();

  // Only the initial GET request should have occurred.
  expect(apiRequest).toHaveBeenCalledTimes(1);
});

test("shows an API error when an edit cannot be saved", async () => {
  window.history.pushState(
    {},
    "",
    "/initiatives/insight-123/edit"
  );

  apiRequest
    .mockResolvedValueOnce({
      data: {
        insightId: "insight-123",
        title: "Monthly Financial Review",
        description: "Review monthly performance",
        category: "Cost Management",
        status: "Open",
      },
    })
    .mockRejectedValueOnce(
      new Error("Unable to update initiative")
    );

  const user = userEvent.setup();

  render(<App />);

  const titleInput =
    await screen.findByLabelText("Title");

  await user.clear(titleInput);
  await user.type(
    titleInput,
    "Updated Financial Review"
  );

  await user.click(
    screen.getByRole("button", {
      name: "Save Changes",
    })
  );

  expect(apiRequest).toHaveBeenLastCalledWith(
    "/api/insights/insight-123",
    expect.objectContaining({
      method: "PUT",
    })
  );

  expect(
    await screen.findByText(
      "Unable to update initiative"
    )
  ).toBeInTheDocument();
});

  
  test("shows a loading message while initiatives are being retrieved", async () => {
  apiRequest.mockReturnValue(
    new Promise(() => {})
  );

  render(<App />);

  expect(
  await screen.findByText(
    "Loading initiatives..."
  )
).toBeInTheDocument();


  // Wait for AppLayout's asynchronous authentication check.
  expect(
    await screen.findByText(
      "Logged in as financial.leader@example.com"
    )
  ).toBeInTheDocument();
});

test("redirects an unauthenticated user from a protected page to login", async () => {
  global.fetch.mockResolvedValue({
    ok: false,
    json: async () => ({
      error: "Unauthorized",
    }),
  });

  window.history.pushState(
    {},
    "",
    "/initiatives"
  );

  render(<App />);

  expect(
    await screen.findByRole("heading", {
      name: "Login",
    })
  ).toBeInTheDocument();

  expect(
    screen.getByRole("button", {
      name: "Login with Cognito",
    })
  ).toBeInTheDocument();

  expect(window.location.pathname).toBe(
    "/login"
  );

  expect(apiRequest).not.toHaveBeenCalled();
});

  test("displays initiatives returned by the API", async () => {
    apiRequest.mockResolvedValue({
      data: [
        {
          insightId: "insight-1",
          title: "Monthly Financial Review",
          category: "Cost Management",
          status: "Open",
        },
      ],
    });

    render(<App />);

    expect(
      await screen.findByText(
        "Monthly Financial Review"
      )
    ).toBeInTheDocument();

    expect(
      screen.getByText("Cost Management")
    ).toBeInTheDocument();

    expect(
      screen.getByText("Open")
    ).toBeInTheDocument();

    expect(
      screen.getByRole("link", {
        name: "View Details",
      })
    ).toHaveAttribute(
      "href",
      "/initiatives/insight-1"
    );
  });

  test("shows an empty state when no initiatives exist", async () => {
    apiRequest.mockResolvedValue({
      data: [],
    });

    render(<App />);

    expect(
      await screen.findByText(
        "No initiatives have been created yet."
      )
    ).toBeInTheDocument();
  });

  test("shows a friendly error when initiatives cannot be loaded", async () => {
    apiRequest.mockRejectedValue(
      new Error("Backend service unavailable")
    );

    render(<App />);

    expect(
      await screen.findByRole("heading", {
        name: "Unable to load initiatives",
      })
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        "Backend service unavailable"
      )
    ).toBeInTheDocument();
  });

  test("shows validation when the create form is submitted without a title", async () => {
    window.history.pushState(
      {},
      "",
      "/initiatives/new"
    );

    const user = userEvent.setup();

    render(<App />);

    await user.click(
  await screen.findByRole("button", {
    name: "Create Initiative",
  })
);


    expect(
      screen.getByText("Title is required.")
    ).toBeInTheDocument();

    expect(apiRequest).not.toHaveBeenCalled();
  });

  test("submits a completed create form and shows an API error", async () => {
    window.history.pushState(
      {},
      "",
      "/initiatives/new"
    );

    apiRequest.mockRejectedValue(
      new Error("Unable to save initiative")
    );

    const user = userEvent.setup();

    render(<App />);

    await user.type(
  await screen.findByLabelText("Title"),
  "Bundled Payment Review"
);


    await user.type(
      screen.getByLabelText("Description"),
      "Review financial performance"
    );

    await user.type(
      screen.getByLabelText("Category"),
      "Value-Based Care"
    );

    await user.click(
      screen.getByRole("button", {
        name: "Create Initiative",
      })
    );

    expect(apiRequest).toHaveBeenCalledWith(
      "/api/insights",
      expect.objectContaining({
        method: "POST",
      })
    );

    expect(
      await screen.findByText(
        "Unable to save initiative"
      )
    ).toBeInTheDocument();
  });

  test("shows an authorization message when another user's record is requested", async () => {
    window.history.pushState(
      {},
      "",
      "/initiatives/private-record"
    );

    apiRequest.mockRejectedValue(
      new Error("Forbidden")
    );

    render(<App />);

    expect(
      await screen.findByText(
        "You are not authorized to view this initiative."
      )
    ).toBeInTheDocument();
  });
});
