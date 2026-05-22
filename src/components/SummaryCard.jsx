import ScrambleText from './ScrambleText';

export default function SummaryCard({
  label,
  value,
  subtitle,
  icon: Icon,
  variant = 'default',
  delay = 0
}) {
  const getVariantClass = () => {
    if (variant === 'success') return 'success';
    if (variant === 'accent') return 'accent';
    if (variant === 'warning') return 'warning';
    if (variant === 'info') return 'info';
    return '';
  };

  const isHighlight = variant === 'highlight';

  return (
    <div className={`stat-card ${isHighlight ? 'stat-card-highlight' : ''} shine-sweep animate-spring stagger-delay-${delay}`}>
      <div className="stat-card-header">
        <div className="stat-card-label">{label}</div>
        {Icon && <Icon className="stat-icon" />}
      </div>
      <div className={`stat-card-value ${getVariantClass()} mono`}>
        {typeof value === 'string' ? <ScrambleText text={value} /> : value}
      </div>
      {subtitle && <div className="stat-card-sub">{subtitle}</div>}
    </div>
  );
}
