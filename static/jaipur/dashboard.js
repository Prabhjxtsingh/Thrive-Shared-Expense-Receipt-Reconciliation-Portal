(() => {
  "use strict";

  const isHttp = location.protocol === "http:" || location.protocol === "https:";
  if (isHttp) {
    import("./live-view.js").then(live => initLive(live)).catch(err => {
      console.warn("Live view init failed, falling back to static mockup:", err);
      initStatic();
    });
  } else {
    initStatic();
  }

  async function initLive(live) {
    const review = document.querySelector("#receipt-review");
    const tool = document.querySelector("#dashboard-tool");
    const toolTitle = document.querySelector("#tool-title");
    const toolContent = document.querySelector("#tool-content");
    const returnFocus = new WeakMap();

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

    let csrfToken = "";
    let currentSession = null;
    let currentGroup = null;
    let groupData = null;
    let currentFilter = "all";
    let currentSelectedId = null;

    async function api(path, method = "GET", body = null, extraHeaders = {}) {
      const options = { method, headers: { ...extraHeaders } };
      if (csrfToken && method !== "GET" && method !== "HEAD") {
        options.headers["X-CSRF-Token"] = csrfToken;
      }
      if (body !== null) {
        if (body instanceof FormData) {
          options.body = body;
        } else {
          options.headers["Content-Type"] = "application/json";
          options.body = JSON.stringify(body);
        }
      }
      const res = await fetch(path, options);
      if (!res.ok) {
        let err = `Request failed: ${res.status}`;
        try {
          const json = await res.json();
          if (json.error) err = json.error;
        } catch {}
        throw new Error(err);
      }
      return res.json();
    }

    try {
      currentSession = await api("/api/session");
      csrfToken = currentSession.csrf || "";
      const groupsRes = await api("/api/groups");
      const groups = groupsRes.groups || [];
      const params = new URLSearchParams(location.search);
      const requestedGroupId = params.get("group");
      if (requestedGroupId) {
        currentGroup = groups.find(g => String(g.id) === requestedGroupId);
      }
      if (!currentGroup) {
        currentGroup = groups.find(g => g.name === "Jaipur Industrial Visit") || groups[0];
      }
      if (!currentGroup) {
        initStatic();
        return;
      }

      async function refreshLive() {
        groupData = await api(`/api/groups/${currentGroup.id}`);
        currentSelectedId = live.renderDashboard(groupData, currentSession, currentSelectedId, currentFilter);
      }

      await refreshLive();

      async function openLiveReview(opener, expenseId) {
        const id = expenseId || currentSelectedId;
        if (!id) return;
        try {
          const expenseDetail = await api(`/api/expenses/${id}`);
          const draft = (expenseDetail.revisions || []).find(r => r.status === "draft");
          let previewData = null;
          if (draft) {
            previewData = await api(`/api/expenses/${id}/preview`, "POST", {
              revision_id: draft.id,
              edit_version: draft.edit_version,
            });
          }
          live.renderReceipt(expenseDetail, previewData, groupData.members);
          openDialog(review, opener);
        } catch (err) {
          console.error("Failed to load receipt review:", err);
        }
      }

      function searchExpenses(opener) {
        openTool("Find an expense", `
          <label class="tool-field">Search expenses<input type="search" placeholder="Transport, dinner, refreshments"></label>
          <div class="tool-results" aria-live="polite"></div>`, opener);
        const query = toolContent.querySelector("input");
        const results = toolContent.querySelector(".tool-results");
        function showResults() {
          const term = query.value.trim().toLowerCase();
          const allEntries = (groupData?.expenses || []).map(entry =>
            live.presentation(entry, groupData.group, currentSession?.demo)
          );
          const matches = allEntries.filter(e =>
            (e.title || e.merchant || "").toLowerCase().includes(term) ||
            (term.includes("refresh") && (e.merchant || "").toLowerCase().includes("refresh")) ||
            (term.includes("dinner") && (e.title || "").toLowerCase().includes("dinner"))
          );
          results.replaceChildren();
          if (!matches.length) {
            results.textContent = "No expenses match this search.";
            return;
          }
          for (const row of matches) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "tool-button";
            button.textContent = row.title || row.merchant;
            button.addEventListener("click", async () => {
              currentSelectedId = row.id;
              currentFilter = "all";
              await refreshLive();
              tool.close();
            });
            results.append(button);
          }
        }
        query.addEventListener("input", showResults);
        showResults();
        query.focus();
      }

      function addMember(opener) {
        openTool("Add member", `
          <form class="tool-form" id="live-invite-form">
            <label class="tool-field">Email<input name="email" type="email" autocomplete="email" required></label>
            <div class="tool-actions"><button type="submit" class="tool-button">Create invitation</button></div>
          </form>
          <div id="invite-result"></div>
        `, opener);
        const form = toolContent.querySelector("form");
        form.querySelector("input").focus();
        form.addEventListener("submit", async event => {
          event.preventDefault();
          const email = form.querySelector("input").value.trim();
          try {
            const inviteRes = await api(`/api/groups/${currentGroup.id}/invites`, "POST", { email });
            const inviteUrl = inviteRes.path;
            toolContent.querySelector("#invite-result").innerHTML = `
              <p>Invitation created:</p>
              <p><a class="tool-button" href="${inviteUrl}">${inviteUrl}</a></p>
            `;
          } catch (err) {
            toolContent.querySelector("#invite-result").innerHTML = `<p class="error">${err.message}</p>`;
          }
        });
      }

      function uploadReceipt(opener) {
        openTool("Upload receipt", `
          <form class="tool-form" id="live-upload-form">
            <label class="tool-field">Choose a receipt<input type="file" name="receipt" accept="image/jpeg,image/png,application/pdf" required></label>
            <div class="tool-actions"><button type="submit" class="tool-button">Upload receipt</button></div>
            <p role="status"></p>
          </form>
        `, opener);
        const form = toolContent.querySelector("form");
        const picker = form.querySelector("input");
        picker.addEventListener("change", () => {
          const file = picker.files[0];
          toolContent.querySelector("[role=status]").textContent = file ? `Selected: ${file.name}` : "";
        });
        form.addEventListener("submit", async event => {
          event.preventDefault();
          const statusEl = toolContent.querySelector("[role=status]");
          statusEl.textContent = "Uploading...";
          try {
            const formData = new FormData(form);
            const res = await api(`/api/groups/${currentGroup.id}/receipts`, "POST", formData);
            tool.close();
            window.location.href = `/workspace?group=${currentGroup.id}#expense/${res.expense_id}`;
          } catch (err) {
            statusEl.textContent = err.message;
          }
        });
      }

      async function addExpense() {
        try {
          const res = await api(`/api/groups/${currentGroup.id}/expenses`, "POST", {});
          window.location.href = `/workspace?group=${currentGroup.id}#expense/${res.id}`;
        } catch (err) {
          console.error("Failed to create expense draft:", err);
        }
      }

      function showNotifications(opener) {
        const pending = (groupData?.expenses || []).filter(e => e.draft_id || !e.current_revision_id);
        if (pending.length) {
          openTool("Notifications", `
            <p>Group dinner has a ₹40.00 difference. Review the receipt before posting.</p>
            <button type="button" class="tool-button" data-action="review" data-receipt="${pending[0].id}">Review receipt</button>
          `, opener);
        } else {
          openTool("Notifications", "<p>All expenses are reviewed and posted.</p>", opener);
        }
      }

      document.addEventListener("click", async event => {
        const button = event.target.closest("button, a");
        const row = event.target.closest("[data-expense]");

        if (button?.dataset.filter) {
          currentFilter = button.dataset.filter;
          await refreshLive();
          return;
        }

        if (button?.dataset.select) {
          currentSelectedId = Number(button.dataset.select);
          await refreshLive();
          return;
        }

        if (button?.dataset.action) {
          const action = button.dataset.action;
          if (action === "review") {
            const rid = button.dataset.receipt ? Number(button.dataset.receipt) : currentSelectedId;
            openLiveReview(button, rid);
          } else if (action === "edit-receipt") {
            const rid = button.dataset.receipt ? Number(button.dataset.receipt) : currentSelectedId;
            window.location.href = `/workspace?group=${currentGroup.id}#expense/${rid}`;
          } else if (action === "close-review") {
            review.close();
          } else if (action === "close-tool") {
            tool.close();
          } else if (action === "add-expense") {
            await addExpense();
          } else if (action === "add-member") {
            addMember(button);
          } else if (action === "upload-receipt" || action === "upload") {
            uploadReceipt(button);
          } else if (action === "search") {
            searchExpenses(button);
          } else if (action === "notifications") {
            showNotifications(button);
          } else if (action === "profile") {
            window.location.href = `/workspace?group=${currentGroup.id}#account`;
          } else if (action === "settings") {
            window.location.href = `/workspace?group=${currentGroup.id}#settings`;
          } else if (action === "logout") {
            openTool("Demo workspace", "<p>You’re viewing the shared Jaipur group dashboard.</p>", button);
          }
          return;
        }

        if (button?.dataset.nav) {
          const nav = button.dataset.nav;
          if (nav === "overview") {
            document.querySelector("main")?.focus();
          } else if (["expenses", "receipts", "balances", "fund", "members"].includes(nav)) {
            window.location.href = `/workspace?group=${currentGroup.id}#${nav}`;
          }
          return;
        }

        if (row && !button) {
          currentSelectedId = Number(row.dataset.expense);
          await refreshLive();
        }
      });

      document.addEventListener("keydown", async event => {
        if (event.key === "Enter") {
          const selectBtn = event.target.closest("[data-select]");
          if (selectBtn) {
            currentSelectedId = Number(selectBtn.dataset.select);
            await refreshLive();
          }
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

    } catch (err) {
      console.warn("Live mode failed to load:", err);
      initStatic();
    }
  }

  function initStatic() {
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
        row.querySelector("[data-select]")?.setAttribute("aria-pressed", String(row === active));
      }
      for (const button of filters) {
        const current = button.dataset.filter === filter;
        button.classList.toggle("is-active", current);
        button.setAttribute("aria-pressed", String(current));
      }
      if (emptyFeed) emptyFeed.hidden = visible.length !== 0;
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
  }
})();