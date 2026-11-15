// broken: a layout whose frame throws on every render. The shell must show
// its classic frame instead, with one toast and an aiui:plugin-error event.
// (Default export instead of registerLayout: the other way a module can
// provide its frame.)
export default function BrokenFrame(props) {
  throw new Error(`The broken fixture frame always throws (page ${props.pageId})`)
}
