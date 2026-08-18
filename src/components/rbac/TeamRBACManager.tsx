import React, { useState } from "react";
import { useDBA } from "../../context/DBAContext";
import { User, RoleType } from "../../types/dba";
import {
  Users,
  ShieldCheck,
  ShieldAlert,
  UserPlus,
  Check,
  X,
  Lock,
  Key,
  FileText,
  Zap,
  Sliders,
} from "lucide-react";

export const TeamRBACManager: React.FC = () => {
  const { users, currentUser, updateUserRole, addUser } = useDBA();

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newUserForm, setNewUserForm] = useState({
    name: "",
    email: "",
    role: "JUNIOR_DBA" as RoleType,
    department: "L1 Database Operations",
  });

  const canManage = currentUser.permissions.canManageUsers;

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserForm.name || !newUserForm.email) return;

    addUser({
      ...newUserForm,
      avatar: `https://images.unsplash.com/photo-${1500000000000 + Math.floor(Math.random() * 1000000)}?auto=format&fit=crop&q=80&w=150`,
      status: "ACTIVE",
      permissions: {
        canViewMetrics: true,
        canEditThresholds: newUserForm.role === "SUPER_ADMIN" || newUserForm.role === "SENIOR_DBA",
        canExecuteRemediation: newUserForm.role === "SUPER_ADMIN" || newUserForm.role === "SENIOR_DBA",
        canManageCredentials: newUserForm.role === "SUPER_ADMIN",
        canManageUsers: newUserForm.role === "SUPER_ADMIN",
        canExportReports: true,
      },
    });

    setAddModalOpen(false);
    setNewUserForm({
      name: "",
      email: "",
      role: "JUNIOR_DBA",
      department: "L1 Database Operations",
    });
  };

  const permissionList = [
    { key: "canViewMetrics", label: "View Performance Metrics" },
    { key: "canEditThresholds", label: "Configure Alert Thresholds" },
    { key: "canExecuteRemediation", label: "Execute Remediation Scripts" },
    { key: "canManageCredentials", label: "Manage Database Passwords & SSL" },
    { key: "canManageUsers", label: "Manage Team RBAC & Assign Roles" },
    { key: "canExportReports", label: "Generate & Export PDF Reports" },
  ];

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-[#272a30] dark:bg-[#1a1d23]">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Users className="h-5 w-5 text-indigo-500" />
            Role-Based Access Control (RBAC) & Team Management
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Configure role permissions for Super Admins, Senior DBAs, Junior DBAs, and Auditors.
          </p>
        </div>

        <button
          onClick={() => {
            if (!canManage) {
              alert("Your logged-in user role does not have 'canManageUsers' permission.");
              return;
            }
            setAddModalOpen(true);
          }}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500 transition cursor-pointer"
        >
          <UserPlus className="h-4 w-4" />
          <span>Invite Team Member</span>
        </button>
      </div>

      {/* Users Directory List */}
      <div className="grid gap-4 md:grid-cols-2">
        {users.map((u) => {
          const isSuper = u.role === "SUPER_ADMIN";
          const isSenior = u.role === "SENIOR_DBA";

          return (
            <div
              key={u.id}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <img
                    src={u.avatar}
                    alt={u.name}
                    className="h-11 w-11 rounded-xl object-cover border border-slate-200 dark:border-slate-700"
                  />
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                      {u.name}
                    </h3>
                    <p className="text-xs text-slate-500">{u.email}</p>
                    <span className="text-[10px] text-slate-400 font-semibold">{u.department}</span>
                  </div>
                </div>

                <select
                  value={u.role}
                  onChange={(e) => updateUserRole(u.id, e.target.value as RoleType)}
                  disabled={!canManage}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-extrabold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer"
                >
                  <option value="SUPER_ADMIN">SUPER ADMIN</option>
                  <option value="SENIOR_DBA">SENIOR DBA</option>
                  <option value="JUNIOR_DBA">JUNIOR DBA</option>
                  <option value="AUDITOR">AUDITOR</option>
                </select>
              </div>

              {/* Permissions Pills */}
              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Effective Privileges</span>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                      u.permissions.canEditThresholds
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "bg-slate-100 text-slate-400 dark:bg-slate-800"
                    }`}
                  >
                    Threshold Edit
                  </span>

                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                      u.permissions.canExecuteRemediation
                        ? "bg-purple-500/10 text-purple-600 dark:text-purple-400"
                        : "bg-slate-100 text-slate-400 dark:bg-slate-800"
                    }`}
                  >
                    Script Execute
                  </span>

                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                      u.permissions.canManageCredentials
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : "bg-slate-100 text-slate-400 dark:bg-slate-800"
                    }`}
                  >
                    Manage Credentials
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Role Permission Matrix Table */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
          <ShieldCheck className="h-4 w-4 text-emerald-500" />
          Role Permission Security Matrix
        </h3>

        <div className="overflow-x-auto text-xs">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-3 font-bold">Permission Action</th>
                <th className="py-2.5 px-3 font-bold text-center">Super Admin</th>
                <th className="py-2.5 px-3 font-bold text-center">Senior DBA</th>
                <th className="py-2.5 px-3 font-bold text-center">Junior DBA</th>
                <th className="py-2.5 px-3 font-bold text-center">Auditor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {permissionList.map((p) => (
                <tr key={p.key}>
                  <td className="py-2.5 px-3 font-bold text-slate-800 dark:text-slate-200">
                    {p.label}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <Check className="mx-auto h-4 w-4 text-emerald-500" />
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    {p.key === "canManageCredentials" || p.key === "canManageUsers" ? (
                      <X className="mx-auto h-4 w-4 text-slate-300 dark:text-slate-600" />
                    ) : (
                      <Check className="mx-auto h-4 w-4 text-emerald-500" />
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    {p.key === "canViewMetrics" || p.key === "canExportReports" ? (
                      <Check className="mx-auto h-4 w-4 text-emerald-500" />
                    ) : (
                      <X className="mx-auto h-4 w-4 text-slate-300 dark:text-slate-600" />
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    {p.key === "canViewMetrics" || p.key === "canExportReports" ? (
                      <Check className="mx-auto h-4 w-4 text-emerald-500" />
                    ) : (
                      <X className="mx-auto h-4 w-4 text-slate-300 dark:text-slate-600" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add User Modal */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900 text-slate-900 dark:text-white">
            <h3 className="text-base font-extrabold flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-emerald-500" />
              Invite Team Member
            </h3>

            <form onSubmit={handleCreateUser} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="font-bold">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sarah Jenkins"
                  value={newUserForm.name}
                  onChange={(e) => setNewUserForm({ ...newUserForm, name: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="font-bold">Email Address</label>
                <input
                  type="email"
                  required
                  placeholder="sarah@datapulse.io"
                  value={newUserForm.email}
                  onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="font-bold">Assign Role</label>
                <select
                  value={newUserForm.role}
                  onChange={(e) => setNewUserForm({ ...newUserForm, role: e.target.value as RoleType })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800"
                >
                  <option value="SUPER_ADMIN">SUPER ADMIN</option>
                  <option value="SENIOR_DBA">SENIOR DBA</option>
                  <option value="JUNIOR_DBA">JUNIOR DBA</option>
                  <option value="AUDITOR">AUDITOR</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 font-bold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-700"
                >
                  Confirm Invite
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
