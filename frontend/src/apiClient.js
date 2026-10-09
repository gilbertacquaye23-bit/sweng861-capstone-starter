const API_BASE_URL = "http://localhost:3000"; // Replace with your backend API base URL

export async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  if (response.status === 403) {
    throw new Error("Forbidden");
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.message || "Something went wrong"
    );
  }

  return data;
}
