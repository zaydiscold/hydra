import { useState } from 'react';
import { useBulkAuth } from '../hooks/useBulkAuth';
import AnimeText from '../components/AnimeText';
import EmailLinkTab from '../components/EmailLinkTab';
import OtpTab from '../components/OtpTab';

const TABS = [
  { id: 'otp', label: '# OTP', subtitle: 'Enter 6-digit code' },
  { id: 'email-link', label: '✉ Email Link', subtitle: 'One click link' },
];

export default function BulkAuthWizard({ addToast }) {
  const [activeTab, setActiveTab] = useState('otp');
  const auth = useBulkAuth(addToast);

  return (
    <div className="page-container" style={{ maxWidth: 740 }}>
      <header className="page-header page-header--intro" style={{ marginBottom: 'var(--space-lg)' }}>
        <div>
          <AnimeText as="h2" mode="lines" variant="scanline" delay={36} style={{ margin: 0 }}>Bulk Account Import</AnimeText>
          <p className="page-header__lede">
            Import OpenRouter accounts into Hydra. Choose <strong>Email Link</strong> for a one-click sign-in (no
            code needed), or <strong>OTP</strong> to enter a 6-digit code per account.
          </p>
        </div>
      </header>

      {/* Tab switcher */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          marginBottom: 'var(--space-lg)',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 10,
          padding: 4,
        }}
      >
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                auth.resetErrors();
              }}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '10px 16px',
                borderRadius: 7,
                border: 'none',
                cursor: 'pointer',
                background: active ? 'var(--accent-primary)' : 'transparent',
                color: active ? '#000' : 'var(--text-secondary)',
                fontWeight: active ? 700 : 400,
                fontSize: '0.9rem',
                transition: 'all 0.15s',
              }}
            >
              {tab.label}
              <span style={{ fontSize: '0.7rem', opacity: 0.7, marginTop: 2, fontWeight: 400 }}>{tab.subtitle}</span>
            </button>
          );
        })}
      </div>

      {activeTab === 'email-link' && (
        <EmailLinkTab 
          pasteText={auth.pasteText}
          setPasteText={auth.setPasteText}
          creating={auth.creating}
          rows={auth.emailLinkRows}
          logLines={auth.emailLinkLog}
          localError={auth.localError}
          errorCopyCommand={auth.errorCopyCommand}
          onSend={auth.handleSendMagicLinks}
          onResend={auth.handleResendMagicLink}
        />
      )}

      {activeTab === 'otp' && (
        <OtpTab 
          pasteText={auth.pasteText}
          setPasteText={auth.setPasteText}
          creating={auth.creating}
          stubSummary={auth.otpStubSummary}
          queue={auth.otpQueue}
          currentIdx={auth.otpCurrentIdx}
          logLines={auth.otpLog}
          signInId={auth.otpSignInId}
          otpCode={auth.otpCode}
          setOtpCode={auth.setOtpCode}
          keyName={auth.otpKeyName}
          setKeyName={auth.setOtpKeyName}
          provisionEnabled={auth.otpProvisionEnabled}
          setProvisionEnabled={auth.setOtpProvisionEnabled}
          busy={auth.otpBusy}
          mergeBusy={auth.otpMergeBusy}
          fetchingKeys={auth.otpFetchingKeys}
          localError={auth.localError}
          errorCopyCommand={auth.errorCopyCommand}
          setCurrentIdx={auth.setOtpCurrentIdx}
          onCreateStubs={auth.handleCreateOtpStubs}
          onSendCode={auth.handleSendOtpCode}
          onVerify={auth.handleVerifyOtp}
          onProvision={auth.handleProvisionOtpKey}
          onFetchKeys={auth.handleFetchOtpKeys}
          onMergeExisting={auth.handleMergeExistingOtp}
          onSkip={auth.handleSkipOtp}
          resetErrors={auth.resetErrors}
        />
      )}
    </div>
  );
}
