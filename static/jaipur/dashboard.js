(() => {
  "use strict";

  const expenses = [...document.querySelectorAll("[data-expense]")];
  const filters = [...document.querySelectorAll("button[data-filter]")];
  const emptyFeed = document.querySelector("#feed-empty");
  const review = document.querySelector("#receipt-review");
  const tool = document.querySelector("#dashboard-tool");
  const toolTitle = document.querySelector("#tool-title");
  const toolContent = document.querySelector("#tool-content");
  const returnFocus = new WeakMap();
  const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

  let filter = "all";
  let selected = expenses.find(row => row.classList.contains("is-selected")) || expenses[0];

  function updateFeed() {
    const visible = expenses.filter(row => filter === "all" || row.dataset.status === filter);
    const active = visible.includes(selected) ? selected : visible[0];
    for (const row of expenses) {
      row.hidden = !visible.includes(row);
      row.classList.toggle("is-selected", row === active);
      row.querySelector("[data-select]").setAttribute("aria-pressed", String(row === active));
    }
    for (const button of filters) {
      const current = button.dataset.filter === filter;
      button.classList.toggle("is-active", current);
      button.setAttribute("aria-pressed", String(current));
    }
    emptyFeed.hidden = visible.length !== 0;
  }

  function selectExpense(id, reveal = false) {
    const row = expenses.find(expense => expense.dataset.expense === id);
    if (!row) return;
    if (reveal && row.hidden) filter = "all";
    selected = row;
    updateFeed();
    return row.querySelector("[data-select]");
  }

  function heading(row) {
    return row.querySelector("[data-expense-title], h2, h3")?.textContent.trim() || row.dataset.expense;
  }

  function expenseAmount(row) {
    return row.querySelector("[data-expense-amount], .expense-amount")?.textContent.trim();
  }

  function openDialog(dialog, opener) {
    if (dialog.open) return;
    returnFocus.set(dialog, opener);
    dialog.showModal();
  }

  function openTool(title, markup, opener) {
    toolTitle.textContent = title;
    toolContent.innerHTML = markup;
    openDialog(tool, opener);
  }

  function note(text) {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    toolContent.replaceChildren(paragraph);
  }

  function openReview(opener, id = "dinner") {
    const row = expenses.find(expense => expense.dataset.expense === id);
    if (id !== "dinner" && row) {
      openTool(heading(row), "<p></p>", opener);
      const amount = expenseAmount(row);
      note(amount ? `Settled · ${amount}` : "This expense is settled.");
      return;
    }
    selectExpense("dinner", true);
    const origin = tool.open ? returnFocus.get(tool) : opener;
    if (tool.open) tool.close();
    openDialog(review, origin);
  }

  function formTool(title, fields, submitLabel, opener, submit) {
    openTool(title, `<form class="tool-form">${fields}
      <div class="tool-actions"><button type="submit" class="tool-button">${submitLabel}</button></div>
    </form>`, opener);
    const form = toolContent.querySelector("form");
    form.querySelector("input, select")?.focus();
    form.addEventListener("submit", event => {
      event.preventDefault();
      submit(new FormData(form));
    });
  }

  function addExpense(opener) {
    formTool("Add expense", `
      <label class="tool-field">Expense name<input name="name" maxlength="80" required></label>
      <label class="tool-field">Amount (₹)<input name="amount" type="number" inputmode="decimal" min="0.01" step="0.01" required></label>
      <label class="tool-field">Category
        <select name="category"><option>Transport</option><option>Food</option><option>Other</option></select>
      </label>`, "Preview expense", opener, data => {
      toolTitle.textContent = "Expense preview";
      note(`${data.get("name")} · ${data.get("category")} · ${currency.format(Number(data.get("amount")))}`);
    });
  }

  function addMember(opener) {
    formTool("Add member", `
      <label class="tool-field">Name<input name="name" maxlength="80" autocomplete="name" required></label>
      <label class="tool-field">Email<input name="email" type="email" autocomplete="email" required></label>
    `, "Preview invitation", opener, data => {
      toolTitle.textContent = "Invitation preview";
      note(`${data.get("name")} · ${data.get("email")} · Jaipur Industrial Visit`);
    });
  }

  function searchExpenses(opener) {
    openTool("Find an expense", `
      <label class="tool-field">Search expenses<input type="search" placeholder="Transport, dinner, refreshments"></label>
      <div class="tool-results" aria-live="polite"></div>`, opener);
    const query = toolContent.querySelector("input");
    const results = toolContent.querySelector(".tool-results");
    function showResults() {
      const term = query.value.trim().toLowerCase();
      const matches = expenses.filter(row => heading(row).toLowerCase().includes(term));
      results.replaceChildren();
      if (!matches.length) {
        results.textContent = "No expenses match this search.";
        return;
      }
      for (const row of matches) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "tool-button";
        button.textContent = heading(row);
        button.addEventListener("click", () => {
          const target = selectExpense(row.dataset.expense, true);
          returnFocus.set(tool, target);
          tool.close();
        });
        results.append(button);
      }
    }
    query.addEventListener("input", showResults);
    showResults();
    query.focus();
  }

  function uploadReceipt(opener) {
    openTool("Upload receipt", `
      <label class="tool-field">Choose a receipt<input type="file" accept="image/jpeg,image/png,application/pdf"></label>
      <p role="status"></p>`, opener);
    const picker = toolContent.querySelector("input");
    picker.addEventListener("change", () => {
      const file = picker.files[0];
      toolContent.querySelector("[role=status]").textContent = file ? `Selected: ${file.name}` : "";
    });
    picker.focus();
  }

  function showNotifications(opener) {
    openTool("Notifications", `
      <p>Group dinner has a ₹40.00 difference. Review the receipt before posting.</p>
      <button type="button" class="tool-button" data-action="review">Review receipt</button>
    `, opener);
  }

  function focusSection(selector) {
    const section = document.querySelector(selector);
    if (!section) return;
    const target = section.querySelector("h1, h2, h3") || section;
    target.tabIndex = -1;
    target.focus();
  }

  const actions = {
    review: button => openReview(button, button.dataset.receipt),
    "close-review": () => review.close(),
    "close-tool": () => tool.close(),
    "add-expense": addExpense,
    "add-member": addMember,
    "upload-receipt": uploadReceipt,
    upload: uploadReceipt,
    search: searchExpenses,
    notifications: showNotifications,
    profile: button => openTool("Your profile", "<p>Jaipur Industrial Visit · Group member</p>", button),
    settings: button => openTool("Workspace settings", "<p>Jaipur Industrial Visit · Indian rupee (INR)</p>", button),
    logout: button => openTool("Demo workspace", "<p>You’re viewing the shared Jaipur group dashboard.</p>", button),
  };
  const navigation = {
    overview: () => focusSection("main"),
    expenses: () => {
      filters[0].focus();
    },
    receipts: button => {
      if (document.querySelector("#receipt-inbox")) focusSection("#receipt-inbox");
      else uploadReceipt(button);
    },
    balances: button => openTool("Balances", "<p>Review the dinner receipt to reconcile member shares.</p>", button),
    fund: button => openTool("Trip fund", "<p>Group advances and refunds appear in the trip fund ledger.</p>", button),
    members: button => openTool("Members", "<p>Three members share expenses in the Jaipur Industrial Visit group.</p>", button),
  };

  document.addEventListener("click", event => {
    const button = event.target.closest("button, a");
    const row = event.target.closest("[data-expense]");
    if (button?.dataset.filter) {
      filter = button.dataset.filter;
      updateFeed();
    } else if (button?.dataset.select) {
      selectExpense(button.dataset.select);
    } else if (button?.dataset.action) {
      actions[button.dataset.action]?.(button);
    } else if (button?.dataset.nav) {
      navigation[button.dataset.nav]?.(button);
    } else if (row && !button) {
      selectExpense(row.dataset.expense);
    }
  });

  for (const dialog of [review, tool]) {
    dialog.addEventListener("click", event => {
      if (event.target !== dialog) return;
      const { left, right, top, bottom } = dialog.getBoundingClientRect();
      if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) {
        dialog.close();
      }
    });
    dialog.addEventListener("close", () => {
      const target = returnFocus.get(dialog);
      if (!review.open && !tool.open && target?.isConnected && !target.closest("[hidden]")) target.focus();
    });
  }

  updateFeed();
})();
