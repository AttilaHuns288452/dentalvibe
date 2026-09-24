export default function Skel({ lines = 3, h = 'h-14', className = '' }) {
  return (
    <div className={'space-y-2 ' + className} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={'animate-pulse bg-gray-200 rounded-lg ' + h} />
      ))}
    </div>
  )
}
