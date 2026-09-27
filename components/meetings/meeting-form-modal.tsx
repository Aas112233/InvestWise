"use client";

import React, { useState } from "react";
import { TopSheet, ERPFormLayout, ERPFormSection, ERPFormGrid, ERPFormField, AppDropdown, DropdownOption, Button } from "@/components/ui";
import { useLocale } from "@/lib/i18n";
import { Meeting } from "@/types";

interface MeetingFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Partial<Meeting>) => Promise<void>;
  initialData?: Meeting | null;
}

export function MeetingFormModal({
  isOpen,
  onClose,
  onSubmit,
  initialData,
}: MeetingFormModalProps) {
  const { t } = useLocale();

  const [title, setTitle] = useState(initialData?.title || "");
  const [meetingType, setMeetingType] = useState<string>(initialData?.meetingType || "");
  const [meetingDate, setMeetingDate] = useState(
    initialData?.meetingDate ? new Date(initialData.meetingDate).toISOString().slice(0, 16) : ""
  );
  const [location, setLocation] = useState(initialData?.location || "HQ / Online");
  const [agenda, setAgenda] = useState(initialData?.agenda || "");
  const [notes, setNotes] = useState(initialData?.notes || "");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const meetingTypeOptions: DropdownOption[] = [
    { value: "FOUNDING_MEMBER", label: t("meetings.types.foundingMember", { defaultValue: "Founding Member" }) },
    { value: "SHAREHOLDER", label: t("meetings.types.shareholder", { defaultValue: "Shareholder" }) },
    { value: "INVESTOR", label: t("meetings.types.investor", { defaultValue: "Investor" }) },
    { value: "GENERAL", label: t("meetings.types.general", { defaultValue: "General Member" }) },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!title.trim()) {
      setErrorMessage(t("meetings.validation.titleRequired", { defaultValue: "Meeting title is required." }));
      return;
    }
    if (!meetingType) {
      setErrorMessage(t("meetings.validation.typeRequired", { defaultValue: "Meeting type is required." }));
      return;
    }
    if (!meetingDate) {
      setErrorMessage(t("meetings.validation.dateRequired", { defaultValue: "Meeting schedule date is required." }));
      return;
    }

    try {
      setIsSubmitting(true);
      await onSubmit({
        title: title.trim(),
        meetingType,
        meetingDate: new Date(meetingDate).toISOString(),
        location: location.trim(),
        agenda: agenda.trim(),
        notes: notes.trim(),
      });
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || t("common.errors.failedToScheduleMeeting", { defaultValue: "Failed to schedule meeting." }));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <TopSheet
      isOpen={isOpen}
      onClose={onClose}
      title={initialData ? t("meetings.editMeeting", { defaultValue: "Edit Meeting" }) : t("meetings.scheduleMeeting", { defaultValue: "Schedule Meeting" })}
      description={t("meetings.formDescription", { defaultValue: "Set meeting agenda, participant group, and scheduling time." })}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {errorMessage && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs rounded-md">
            {errorMessage}
          </div>
        )}

        <ERPFormSection title={t("meetings.meetingDetails", { defaultValue: "Schedule & Scope" })}>
          <ERPFormGrid cols={2}>
            <ERPFormField label={t("meetings.title", { defaultValue: "Meeting Title *" })}>
              <input
                type="text"
                placeholder={t("meetings.titlePlaceholder", { defaultValue: "e.g. Q3 Governance & Dividends Review" })}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
              />
            </ERPFormField>

            <ERPFormField label={t("meetings.meetingType", { defaultValue: "Participant Scope *" })}>
              <AppDropdown
                options={meetingTypeOptions}
                value={meetingType}
                onChange={(val) => setMeetingType(val || "")}
                placeholder={t("meetings.selectType", { defaultValue: "Select meeting type..." })}
              />
            </ERPFormField>
          </ERPFormGrid>

          <ERPFormGrid cols={2}>
            <ERPFormField label={t("meetings.dateTime", { defaultValue: "Date & Time *" })}>
              <input
                type="datetime-local"
                value={meetingDate}
                onChange={(e) => setMeetingDate(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
              />
            </ERPFormField>

            <ERPFormField label={t("meetings.location", { defaultValue: "Location / Venue" })}>
              <input
                type="text"
                placeholder="HQ Meeting Room / Google Meet"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
              />
            </ERPFormField>
          </ERPFormGrid>
        </ERPFormSection>

        <ERPFormSection title={t("meetings.agendaSection", { defaultValue: "Agenda & Notes" })}>
          <ERPFormField label={t("meetings.agenda", { defaultValue: "Official Agenda" })}>
            <textarea
              rows={3}
              placeholder={t("meetings.agendaPlaceholder", { defaultValue: "1. Financial report review\n2. Shareholder votes\n3. New projects" })}
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors font-mono"
            />
          </ERPFormField>

          <ERPFormField label={t("meetings.notes", { defaultValue: "Preparation Notes" })}>
            <textarea
              rows={2}
              placeholder={t("meetings.notesPlaceholder", { defaultValue: "Internal instructions for meeting moderator..." })}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
            />
          </ERPFormField>
        </ERPFormSection>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
          <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={isSubmitting}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button variant="primary" size="sm" type="submit" loading={isSubmitting}>
            {initialData ? t("common.saveChanges", { defaultValue: "Save Changes" }) : t("meetings.scheduleButton", { defaultValue: "Schedule Meeting" })}
          </Button>
        </div>
      </form>
    </TopSheet>
  );
}
