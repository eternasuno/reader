Feature: RSS feed folders
  To read subscriptions grouped by topic
  As a signed-in user
  I want to put multiple RSS feeds into one folder and, like "全部订阅", list articles, filter and mark as read within the folder scope

  Folders are single-level: a folder holds feeds, not folders. A feed belongs to at most one folder,
  and feeds that belong to no folder stay at the top level of the "订阅源" section of the sidebar.
  A folder name must not be empty after trimming leading and trailing spaces, and must not duplicate
  another folder of the same user.
  The article list reloads from the first page only when I enter a scope, select a scope, switch a filter
  or click refresh (following the existing rules).

  Background:
    Given I am signed in
    And I have the following folders: Empty, News, Tech
    And I have the following feeds:
      | Feed         | Folder | Unread |
      | Go Blog      | Tech   | 3      |
      | Rust Blog    | Tech   | 2      |
      | BBC          | News   | 4      |
      | Zeta Daily   |        | 5      |
      | Alpha Weekly |        | 1      |

  Rule: Sidebar display

    Scenario: Folders come first ordered by name, and feeds without a folder follow ordered by title
      When I open the reader
      Then the "订阅源" section of the sidebar shows the following from top to bottom:
        | Row          | Type   | Folder |
        | Empty        | Folder |        |
        | News         | Folder |        |
        | BBC          | Feed   | News   |
        | Tech         | Folder |        |
        | Go Blog      | Feed   | Tech   |
        | Rust Blog    | Feed   | Tech   |
        | Alpha Weekly | Feed   |        |
        | Zeta Daily   | Feed   |        |
      And the feeds inside a folder are shown indented relative to the folder

    Scenario: A folder's unread count is the sum of its feeds' unread counts
      When I open the reader
      Then the folder "Tech" shows unread count 5
      And the folder "News" shows unread count 4
      And the folder "Empty" shows its unread count the same way as a feed with 0 unread

    Scenario: "全部订阅" still includes the feeds in folders
      When I open the reader
      Then "全部订阅" shows unread count 15

    Scenario: Folder rows and feed rows share the interaction of the row and the menu
      When I hover over the folder "Tech" or focus it with the keyboard
      Then its unread count position is replaced by the ⋯ menu button
      And the menu button is aligned in size and position with the menu buttons of feed rows

  Rule: Collapsing and expanding

    Scenario: Clicking the arrow collapses the folder without changing the current reading scope
      Given the current reading scope is "全部订阅"
      When I click the arrow of the folder "Tech"
      Then Go Blog and Rust Blog are no longer shown in the sidebar
      And the current reading scope is still "全部订阅" and the article list does not reload

    Scenario: A collapsed folder still shows its unread count
      Given the folder "Tech" is collapsed
      Then the folder "Tech" shows unread count 5

    Scenario: Clicking the arrow expands the folder
      Given the folder "Tech" is collapsed
      When I click the arrow of the folder "Tech"
      Then Go Blog and Rust Blog are shown under the folder "Tech" again

    Scenario: The collapsed state is kept in this browser
      Given I collapsed the folder "Tech"
      When I reopen the reader in the same browser
      Then the folder "Tech" is still collapsed
      And the folder "News" is still expanded

    Scenario: Folders without a saved collapsed state are expanded by default
      When I sign in in a browser that has never opened the reader
      Then all folders are expanded

    Scenario: Selecting a feed inside a collapsed folder expands that folder
      Given the folder "Tech" is collapsed
      When I subscribe to a new feed and choose the folder "Tech"
      Then the folder "Tech" expands
      And the new feed is selected

  Rule: The article list of a folder scope

    Scenario: Clicking a folder name lists the articles of all feeds in the folder
      When I click the name of the folder "Tech"
      Then the folder "Tech" is selected
      And the article list reloads from the first page
      And the article list contains only the articles of Go Blog and Rust Blog, ordered from newest to oldest by arrival order
      And the list title shows "Tech" and unread count 5

    Scenario Outline: A folder list shares the "只显示未读" filter
      Given "只显示未读" is <filter>
      When I click the name of the folder "Tech"
      Then the article list <content>
      When I click "全部订阅" again
      Then "只显示未读" is still <filter>

      Examples:
        | Filter    | Content                                                     |
        | Checked   | contains only the unread articles of Go Blog and Rust Blog  |
        | Unchecked | contains all the articles of Go Blog and Rust Blog          |

    Scenario: Toggling "只显示未读" in a folder list
      Given the current reading scope is the folder "Tech"
      And "只显示未读" is unchecked
      When I check "只显示未读" in the ⋯ menu of the article list
      Then the article list reloads from the first page
      And contains only the unread articles of Go Blog and Rust Blog

    Scenario: Marking the loaded articles as read
      Given the current reading scope is the folder "Tech"
      And the list has loaded only some of the articles of the folder "Tech"
      When I click the "将已加载文章标为已读" icon to the right of the list title
      Then the loaded unread articles are all shown as read
      And the unloaded articles stay unread
      And the unread count of the folder "Tech" decreases accordingly

    Scenario: Marking the whole folder as read from the article list menu
      Given the current reading scope is the folder "Tech"
      When I click "全部标记为已读" in the ⋯ menu of the article list
      Then all the articles of Go Blog and Rust Blog are marked as read, including the unloaded articles
      And the unread count of the folder "Tech" becomes 0
      And the unread counts of BBC, Zeta Daily and Alpha Weekly stay unchanged
      And the unread count of "全部订阅" becomes 10

    Scenario: The article list menu of a folder scope offers only filtering and mark-all-as-read
      Given the current reading scope is the folder "Tech"
      When I open the ⋯ menu of the article list
      Then the menu contains only "只显示未读" and "全部标记为已读"
      And does not contain "新增文章链接", "删除 RSS 源", "重命名目录" or "删除目录"

    Scenario: An empty folder shows the empty state
      When I click the name of the folder "Empty"
      Then the article list is empty
      And the empty state says that this folder has no feeds yet and that a feed can be moved here from a feed's menu

    Scenario: Marking all as read rolls back when it fails
      Given the current reading scope is the folder "Tech"
      And the server cannot handle the request
      When I click "全部标记为已读" in the ⋯ menu of the article list
      Then an error message is shown
      And the read state of the articles and the unread counts return to what they were before the operation

  Rule: The sidebar folder menu

    Scenario: The contents of the sidebar folder menu
      When I open the ⋯ menu of the sidebar folder "Tech"
      Then the menu shows "只显示未读", "全部标记为已读", "重命名目录" and "删除目录" in this order
      And "删除目录" is separated from the items above and shown in the danger color

    Scenario: Marking all as read from the sidebar folder menu applies to the clicked folder
      Given the current reading scope is the feed "Zeta Daily"
      When I click "全部标记为已读" in the ⋯ menu of the sidebar folder "Tech"
      Then the folder "Tech" is selected and the article list switches to the folder "Tech"
      And all the articles of Go Blog and Rust Blog are marked as read
      And the unread count of Zeta Daily is still 5

    Scenario: Toggling "只显示未读" from the sidebar folder menu applies to the clicked folder
      Given the current reading scope is "全部订阅"
      And "只显示未读" is unchecked
      When I check "只显示未读" in the ⋯ menu of the sidebar folder "Tech"
      Then the folder "Tech" is selected
      And the article list contains only the unread articles of Go Blog and Rust Blog

    Scenario: The action is not applied to another scope before the scope switch completes
      Given I clicked "全部标记为已读" in the ⋯ menu of the sidebar folder "Tech"
      When I select the feed "Zeta Daily" while the switch to the folder "Tech" has not completed yet
      Then the articles of Zeta Daily are not marked as read

  Rule: Creating a folder

    Scenario: The plus next to "订阅源" opens the add menu
      When I click the plus to the right of "订阅源" in the sidebar
      Then the popup menu shows "新增 RSS 订阅" and "新建目录"

    Scenario: Creating a folder
      When I click "新建目录" in the plus menu
      Then the popup menu closes and the "新建目录" dialog opens with an empty name input that has focus
      When I type "Design" and submit
      Then the dialog closes
      And an expanded empty folder "Design" appears in the sidebar in name order
      And the current reading scope stays unchanged

    Scenario: Folder names are trimmed of leading and trailing spaces
      When I create a folder named "  Design  "
      Then the sidebar shows the folder "Design"

    Scenario Outline: Invalid folder names
      Given the "新建目录" dialog is open
      When I type <input> into the name and submit
      Then <message>
      And no folder is created
      And the dialog stays open and keeps my input

      Examples:
        | Input                         | Message                                             |
        | Empty content                 | Browser-native validation says the name is required |
        | Only spaces                   | Shows the error "请输入目录名称"                     |
        | "Tech"                        | Shows the error "该目录名称已存在"                   |
        | "Tech" with surrounding spaces | Shows the error "该目录名称已存在"                  |

    Scenario: Closing the new folder dialog
      Given the "新建目录" dialog is open
      When I press Esc or click the close button
      Then the dialog closes and no folder is created
      And focus returns to the plus button

  Rule: Renaming a folder

    Scenario: Renaming a folder
      When I click "重命名目录" in the ⋯ menu of the sidebar folder "Tech"
      Then the "重命名目录" dialog opens with "Tech" prefilled in the name input
      When I change the name to "Engineering" and submit
      Then the dialog closes
      And the folder "Engineering" is shown in the sidebar in name order and still contains Go Blog and Rust Blog
      And the current reading scope stays unchanged

    Scenario: Renaming the currently selected folder
      Given the current reading scope is the folder "Tech"
      When I rename the folder "Tech" to "Engineering"
      Then the list title shows "Engineering"
      And the article list does not reload

    Scenario: Renaming to an existing name
      When I rename the folder "Tech" to "News"
      Then an error that the folder name already exists is shown
      And the dialog stays open
      And the name of the folder "Tech" stays unchanged

    Scenario: Submitting without changing the name
      When I open the "重命名目录" dialog of the folder "Tech" and submit directly
      Then the dialog closes
      And the folder "Tech" stays unchanged

  Rule: Moving feeds into or out of a folder

    Scenario: The feed menu offers "移动到目录"
      When I open the ⋯ menu of the sidebar feed "Zeta Daily"
      Then the menu shows "只显示未读", "全部标记为已读", "移动到目录" and "删除 RSS 源" in this order

    Scenario: The move dialog preselects the current folder
      When I click "移动到目录" in the ⋯ menu of the feed "Go Blog"
      Then the popup menu closes and the "移动到目录" dialog opens
      And the folder dropdown lists "不放入目录", "Empty", "News" and "Tech" in this order
      And "Tech" is preselected

    Scenario: Moving a feed that has no folder into a folder
      When I move the feed "Zeta Daily" to the folder "News"
      Then the dialog closes
      And Zeta Daily is shown under the folder "News" in title order
      And the unread count of the folder "News" becomes 9
      And the articles and read state of Zeta Daily stay unchanged

    Scenario: Moving a feed out of a folder
      When I move the feed "Go Blog" to "不放入目录"
      Then Go Blog is shown among the top-level feeds without a folder in title order
      And the unread count of the folder "Tech" becomes 2

    Scenario: Moving a feed between folders
      When I move the feed "Go Blog" to the folder "News"
      Then Go Blog is shown under the folder "News" and is no longer shown under the folder "Tech"
      And the unread count of the folder "Tech" becomes 2
      And the unread count of the folder "News" becomes 7

    Scenario: Confirming the original folder makes no change
      When I open the "移动到目录" dialog of the feed "Go Blog" and confirm directly
      Then the dialog closes
      And Go Blog is still under the folder "Tech"

    Scenario: Moving a feed does not automatically reload the current list
      Given the current reading scope is the folder "Tech"
      And the article list has loaded the articles of Go Blog
      When I move the feed "Go Blog" to "不放入目录"
      Then the unread count of the folder "Tech" immediately becomes 2
      But the article list does not reload and still shows the loaded articles of Go Blog
      When I click the refresh button
      Then the article list no longer contains the articles of Go Blog

    Scenario: Marking the original folder as read after moving a feed out does not affect the moved-out articles that are still shown
      Given the current reading scope is the folder "Tech"
      And the article list has loaded the unread articles of Go Blog and Rust Blog
      And I just moved the feed "Go Blog" to "不放入目录"
      When I click "全部标记为已读" in the ⋯ menu of the article list
      Then the articles of Rust Blog are all marked as read
      But the Go Blog articles still shown in the list stay unread and the unread count of Go Blog stays unchanged

    Scenario: A folder is kept after its last feed is moved away
      When I move the feed "BBC" to "不放入目录"
      Then the folder "News" is still shown in the sidebar without feeds

    Scenario: "移动到目录" is not offered when there are no folders
      Given I have no folders
      When I open the ⋯ menu of the sidebar feed "Zeta Daily"
      Then the menu does not contain "移动到目录"

    Scenario: The move fails
      Given the server cannot handle the request
      When I move the feed "Zeta Daily" to the folder "News"
      Then an error is shown
      And the dialog stays open
      And Zeta Daily is still among the top-level feeds without a folder

  Rule: Choosing a folder when subscribing (after the preview and before confirming the subscription)

    Scenario: The address form has no folder selection
      When I click "新增 RSS 订阅" in the plus menu
      Then the "新增 RSS 订阅" dialog has only an address input and the "预览订阅" button
      And has no folder dropdown

    Scenario: After a successful preview I choose the folder in the confirmation area, defaulting to no folder
      Given the "新增 RSS 订阅" dialog is open
      When I fill in the address of a new feed and preview it
      Then the preview area shows a folder dropdown below the feed information, listing "不放入目录", "Empty", "News" and "Tech" in this order
      And "不放入目录" is preselected
      And the dropdown is above the "确认订阅" and "返回修改" buttons

    Scenario: Subscribing into a given folder
      Given I have completed the preview of a new feed in the "新增 RSS 订阅" dialog
      When I choose the folder "Tech" in the preview area and confirm the subscription
      Then the dialog closes
      And the new feed is shown under the folder "Tech" and is selected
      And the new feed has no articles before its first refresh

    Scenario: Subscribing without putting the feed into a folder
      Given I have completed the preview of a new feed in the "新增 RSS 订阅" dialog
      When I keep "不放入目录" and confirm the subscription
      Then the new feed is shown among the top-level feeds without a folder and is selected

    Scenario: Previewing again after returning to edit keeps the folder choice
      Given I chose the folder "Tech" in the preview area
      When I click "返回修改"
      Then the address stays in the form
      When I preview again
      Then the folder dropdown in the preview area still preselects "Tech"

    Scenario: Reopening the subscribe dialog resets the folder choice
      Given I closed the dialog after choosing the folder "Tech" in the preview area last time
      When I open the "新增 RSS 订阅" dialog again and complete a preview
      Then the folder dropdown preselects "不放入目录"

    Scenario: The folder cannot be changed while the subscription is being confirmed
      Given I have chosen the folder "Tech" in the preview area and clicked "确认订阅"
      When the subscription request has not completed yet
      Then the folder dropdown and both buttons are not operable

    Scenario: Subscribing to a feed that is already subscribed does not change its folder
      When I preview the address of Zeta Daily, choose the folder "Tech" in the preview area and confirm the subscription
      Then the existing feed "Zeta Daily" opens
      And Zeta Daily is still among the top-level feeds without a folder

    Scenario: The preview area shows no folder selection when there are no folders
      Given I have no folders
      When I complete a preview in the "新增 RSS 订阅" dialog
      Then the preview area has no folder dropdown and shows "确认订阅" and "返回修改" directly

  Rule: Deleting a folder also unsubscribes the feeds in it

    Scenario: Confirming before deleting a folder
      When I click "删除目录" in the ⋯ menu of the sidebar folder "Tech"
      Then a confirmation pops up: "删除目录「Tech」并取消订阅其中的 2 个订阅源？这些源的文章会被删除，已保存的稍后阅读不会删除。"

    Scenario: Cancelling the deletion
      When I cancel in the confirmation for deleting the folder "Tech"
      Then the folder "Tech", Go Blog and Rust Blog are all kept

    Scenario: Confirming the deletion of a folder
      Given I saved an article of Go Blog to "稍后阅读"
      When I confirm deleting the folder "Tech"
      Then the folder "Tech", Go Blog and Rust Blog disappear from the sidebar
      And the articles of Go Blog and Rust Blog are deleted
      And the article saved in "稍后阅读" still exists
      And the unread count of "全部订阅" becomes 10
      And BBC, Zeta Daily and Alpha Weekly are unaffected

    Scenario: Deleting an empty folder
      When I click "删除目录" in the ⋯ menu of the sidebar folder "Empty"
      Then a confirmation pops up: "删除目录「Empty」？"
      When I confirm
      Then the folder "Empty" disappears from the sidebar

    Scenario Outline: Deleting a folder that contains the current reading scope returns to "全部订阅"
      Given the current reading scope is <scope>
      When I confirm deleting the folder "Tech"
      Then the current reading scope becomes "全部订阅"
      And the article list reloads from the first page

      Examples:
        | Scope              |
        | the folder "Tech"  |
        | the feed "Go Blog" |

    Scenario: Deleting a folder unrelated to the current reading scope
      Given the current reading scope is the feed "Zeta Daily"
      When I confirm deleting the folder "Tech"
      Then the current reading scope is still the feed "Zeta Daily"
      And the article list does not reload

    Scenario: The deletion fails
      Given the server cannot handle the request
      When I confirm deleting the folder "Tech"
      Then an error is shown
      And the folder "Tech", Go Blog and Rust Blog are all kept
